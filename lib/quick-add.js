// Quick Add Magic — plain-JS port of the Vikunja frontend's
// frontend/src/modules/quickAddMagic/ (https://github.com/go-vikunja/vikunja),
// so the popup parses task text exactly like the web app does.
//
// Official prefixes (vikunja mode): *label, +project, !priority, @assignee.
// Todoist mode: @label, #project, !priority, +assignee.
// Disabled mode: no parsing (quote-escape still applies, like the frontend).
(() => {
  'use strict';

  const PrefixMode = {
    Disabled: 'disabled',
    Default: 'vikunja',
    Todoist: 'todoist',
  };

  const VIKUNJA_PREFIXES = { label: '*', project: '+', priority: '!', assignee: '@' };
  const TODOIST_PREFIXES = { label: '@', project: '#', priority: '!', assignee: '+' };
  const PREFIXES = {
    [PrefixMode.Disabled]: undefined,
    [PrefixMode.Default]: VIKUNJA_PREFIXES,
    [PrefixMode.Todoist]: TODOIST_PREFIXES,
  };

  const PRIORITIES = { UNSET: 0, LOW: 1, MEDIUM: 2, HIGH: 3, URGENT: 4, DO_NOW: 5 };

  const REPEAT_TYPES = {
    Seconds: 'seconds',
    Minutes: 'minutes',
    Hours: 'hours',
    Days: 'days',
    Weeks: 'weeks',
    Months: 'months',
    Years: 'years',
  };

  const TASK_REPEAT_MODES = {
    REPEAT_MODE_DEFAULT: 0,
    REPEAT_MODE_MONTH: 1,
    REPEAT_MODE_FROM_CURRENT_DATE: 2,
  };

  const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const replaceAll = (str, search, replace) => {
    const esc = search.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const reg = new RegExp(esc, 'ig');
    return str.replace(reg, replace);
  };

  function calculateNearestHours(currentDate = new Date()) {
    const hours = currentDate.getHours();
    const minutes = currentDate.getMinutes();
    const isBeforeOrAt = (breakpoint) =>
      hours < breakpoint || (hours === breakpoint && minutes === 0);

    if (isBeforeOrAt(9) || hours > 21) return 9;
    if (isBeforeOrAt(12)) return 12;
    if (isBeforeOrAt(15)) return 15;
    if (isBeforeOrAt(18)) return 18;
    if (isBeforeOrAt(21)) return 21;
    return 9;
  }

  function calculateDayInterval(dateString, currentDay = new Date().getDay()) {
    switch (dateString) {
      case 'today':
        return 0;
      case 'tomorrow':
        return 1;
      case 'nextMonday':
        return (currentDay + (8 - currentDay * 2)) % 7;
      case 'thisWeekend':
        return (6 - currentDay) % 6;
      case 'laterThisWeek':
        if (currentDay === 5 || currentDay === 6 || currentDay === 0) {
          return 0;
        }
        return 2;
      case 'laterNextWeek':
        return calculateDayInterval('laterThisWeek', currentDay) + 7;
      case 'nextWeek':
        return 7;
      default:
        return 0;
    }
  }

  function getDateFromInterval(interval) {
    const newDate = new Date();
    newDate.setDate(newDate.getDate() + interval);
    newDate.setHours(calculateNearestHours(newDate), 0, 0);
    return newDate;
  }

  function getItemsFromPrefix(text, prefix) {
    const items = [];
    const itemParts = text.split(' ' + prefix);
    if (text.startsWith(prefix)) {
      const firstItem = text.split(prefix)[1];
      itemParts.unshift(firstItem);
    }

    itemParts.forEach((p, index) => {
      if (index < 1) return;
      if (p.startsWith(prefix)) {
        p = p.substring(1);
      }
      let itemText;
      if (p.charAt(0) === "'") {
        itemText = p.split("'")[1];
      } else if (p.charAt(0) === '"') {
        itemText = p.split('"')[1];
      } else {
        itemText = p.split(' ')[0];
      }
      if (itemText !== '') {
        items.push(itemText);
      }
    });

    return Array.from(new Set(items));
  }

  function getProjectFromPrefix(text, prefixMode) {
    const projectPrefix = PREFIXES[prefixMode]?.project;
    if (typeof projectPrefix === 'undefined') {
      return null;
    }
    const projects = getItemsFromPrefix(text, projectPrefix);
    return projects.length > 0 ? projects[0] : null;
  }

  function getLabelsFromPrefix(text, prefixMode) {
    const labelsPrefix = PREFIXES[prefixMode]?.label;
    if (typeof labelsPrefix === 'undefined') {
      return null;
    }
    return getItemsFromPrefix(text, labelsPrefix);
  }

  function getPriority(text, prefix) {
    const ps = getItemsFromPrefix(text, prefix);
    if (ps.length === 0) {
      return null;
    }
    for (const p of ps) {
      for (const pi of Object.values(PRIORITIES)) {
        if (pi === parseInt(p, 10)) {
          return parseInt(p, 10);
        }
      }
    }
    return null;
  }

  function getRepeats(text) {
    const regex = /(^| )(((every|each) (([0-9]+|one|two|three|four|five|six|seven|eight|nine|ten) )?(hours?|days?|weeks?|months?|years?))|(annually|biannually|semiannually|biennially|daily|hourly|monthly|weekly|yearly))($| )/ig;
    const results = regex.exec(text);
    if (results === null) {
      return { textWithoutMatched: text, repeats: null };
    }

    let amount;
    switch (results[5] ? results[5].trim() : undefined) {
      case 'one': amount = 1; break;
      case 'two': amount = 2; break;
      case 'three': amount = 3; break;
      case 'four': amount = 4; break;
      case 'five': amount = 5; break;
      case 'six': amount = 6; break;
      case 'seven': amount = 7; break;
      case 'eight': amount = 8; break;
      case 'nine': amount = 9; break;
      case 'ten': amount = 10; break;
      default:
        amount = results[5] ? parseInt(results[5], 10) : 1;
    }
    let type = REPEAT_TYPES.Hours;

    switch (results[2]) {
      case 'biennially':
        type = REPEAT_TYPES.Years;
        amount = 2;
        break;
      case 'biannually':
      case 'semiannually':
        type = REPEAT_TYPES.Months;
        amount = 6;
        break;
      case 'yearly':
      case 'annually':
        type = REPEAT_TYPES.Years;
        break;
      case 'daily':
        type = REPEAT_TYPES.Days;
        break;
      case 'hourly':
        type = REPEAT_TYPES.Hours;
        break;
      case 'monthly':
        type = REPEAT_TYPES.Months;
        break;
      case 'weekly':
        type = REPEAT_TYPES.Weeks;
        break;
      default:
        switch (results[7]) {
          case 'hour':
          case 'hours':
            type = REPEAT_TYPES.Hours;
            break;
          case 'day':
          case 'days':
            type = REPEAT_TYPES.Days;
            break;
          case 'week':
          case 'weeks':
            type = REPEAT_TYPES.Weeks;
            break;
          case 'month':
          case 'months':
            type = REPEAT_TYPES.Months;
            break;
          case 'year':
          case 'years':
            type = REPEAT_TYPES.Years;
            break;
        }
    }

    let matchedText = results[0];
    if (matchedText.endsWith(' ')) {
      matchedText = matchedText.substring(0, matchedText.length - 1);
    }

    return {
      textWithoutMatched: text.replace(matchedText, ''),
      repeats: { amount, type },
    };
  }

  function cleanupItemText(text, items, prefix) {
    items.forEach((l) => {
      if (l === '') {
        return;
      }
      const escaped = escapeRegExp(l);
      text = text
        .replace(new RegExp(`\\${prefix}'${escaped}' `, 'ig'), '')
        .replace(new RegExp(`\\${prefix}'${escaped}'`, 'ig'), '')
        .replace(new RegExp(`\\${prefix}"${escaped}" `, 'ig'), '')
        .replace(new RegExp(`\\${prefix}"${escaped}"`, 'ig'), '')
        .replace(new RegExp(`\\${prefix}${escaped} `, 'ig'), '')
        .replace(new RegExp(`\\${prefix}${escaped}`, 'ig'), '');
    });
    return text;
  }

  function cleanupResult(result, prefixes) {
    result.text = cleanupItemText(result.text, result.labels, prefixes.label);
    result.text =
      result.project !== null
        ? cleanupItemText(result.text, [result.project], prefixes.project)
        : result.text;
    result.text =
      result.priority !== null
        ? cleanupItemText(result.text, [String(result.priority)], prefixes.priority)
        : result.text;
    // Not removing assignees to avoid removing @text where the user does not exist
    result.text = result.text.trim();
    return result;
  }

  const monthsRegexGroup = '(january|february|march|april|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)';

  // Matches a date regex against text, rejecting matches that appear in the
  // middle of text with non-date content on both sides. This prevents false
  // positives like "The 9/11 Report" while still allowing "meeting 9/11 at 10:00".
  function matchDateAtBoundary(text, pattern) {
    const regex = new RegExp(`(^| )${pattern}($| )`, 'gi');
    let result;
    while ((result = regex.exec(text)) !== null) {
      const matchEnd = result.index + result[0].length;
      const isAtStart = result.index === 0;
      const isAtEnd = matchEnd >= text.length;

      if (isAtStart || isAtEnd) return result;

      const afterMatch = text.substring(matchEnd);
      if (/^(at |@ )/i.test(afterMatch)) return result;
    }
    return null;
  }

  function matchesDateExpr(text, dateExpr) {
    return text.match(new RegExp('(^| )' + dateExpr, 'gi')) !== null;
  }

  function getDateFromWeekday(text, date = new Date()) {
    const matcher = /(^| )(next )?(monday|mon|tuesday|tue|wednesday|wed|thursday|thu|friday|fri|saturday|sat|sunday|sun)($| )/g;
    const results = matcher.exec(text.toLowerCase());
    if (results === null) {
      return { foundText: null, date: null };
    }

    const currentDay = date.getDay();
    let day;
    switch (results[3]) {
      case 'mon':
      case 'monday': day = 1; break;
      case 'tue':
      case 'tuesday': day = 2; break;
      case 'wed':
      case 'wednesday': day = 3; break;
      case 'thu':
      case 'thursday': day = 4; break;
      case 'fri':
      case 'friday': day = 5; break;
      case 'sat':
      case 'saturday': day = 6; break;
      case 'sun':
      case 'sunday': day = 0; break;
      default:
        return { foundText: null, date: null };
    }

    const distance = (day + 7 - currentDay) % 7;
    date.setDate(date.getDate() + distance);

    let foundText = results[0];
    if (foundText.endsWith(' ')) {
      foundText = foundText.slice(0, foundText.length - 1);
    }

    return { foundText, date };
  }

  function getDayFromText(text, now = new Date()) {
    // Only match ordinals when followed by end-of-string, time expressions, or
    // month names. This prevents matching "2nd Floor" or "13th floor" as dates.
    const matcher = new RegExp('(^| )(([1-2][0-9])|(3[01])|(0?[1-9]))(st|nd|rd|th|\\.)(?=$| at | @ | ' + monthsRegexGroup + ')', 'ig');
    const results = matcher.exec(text);
    if (results === null) {
      return { foundText: null, date: null };
    }

    const date = new Date(now);
    const day = parseInt(results[0], 10);
    date.setDate(day);

    while (date < now) {
      date.setMonth(date.getMonth() + 1);
    }

    if (date.getDate() !== day) {
      date.setDate(day);
    }

    return { foundText: results[0], date };
  }

  function getMonthFromText(text, date) {
    const matcher = new RegExp('\\b' + monthsRegexGroup + '\\b', 'ig');
    const results = matcher.exec(text);
    if (results === null) {
      return { newText: text, date };
    }

    const fullDate = new Date(`${results[0]} 1 ${new Date().getFullYear()}`);
    date.setMonth(fullDate.getMonth());
    return {
      newText: replaceAll(text, results[0], ''),
      date,
    };
  }

  function getDateFromTextIn(text, now = new Date()) {
    const regex = /(in [0-9]+ (hours?|days?|weeks?|months?))/ig;
    const results = regex.exec(text);
    if (results === null) {
      return { foundText: '', date: null };
    }

    const foundText = results[0];
    const date = new Date(now);
    const parts = foundText.split(' ');
    switch (parts[2]) {
      case 'hours':
      case 'hour':
        date.setHours(date.getHours() + parseInt(parts[1], 10));
        break;
      case 'days':
      case 'day':
        date.setDate(date.getDate() + parseInt(parts[1], 10));
        break;
      case 'weeks':
      case 'week':
        date.setDate(date.getDate() + parseInt(parts[1], 10) * 7);
        break;
      case 'months':
      case 'month':
        date.setMonth(date.getMonth() + parseInt(parts[1], 10));
        break;
    }

    return { foundText, date };
  }

  function getDateFromText(text, now = new Date()) {
    const datePatterns = [
      '(?<found>(?<month>[0-9][0-9]?)\\/(?<day>[0-9][0-9]?)(\\/(?<year>[0-9][0-9]([0-9][0-9])?))?)',
      '(?<found>(?<year>[0-9][0-9][0-9][0-9]?)\\/(?<month>[0-9][0-9]?)\\/(?<day>[0-9][0-9]))',
      '(?<found>(?<year>[0-9][0-9][0-9][0-9]?)-(?<month>[0-9][0-9]?)-(?<day>[0-9][0-9]))',
      '(?<found>(?<day>[0-9][0-9]?)\\.(?<month>[0-9][0-9]?)(\\.(?<year>[0-9][0-9]([0-9][0-9])?))?)',
    ];

    let result = null;
    let results;
    let foundText = '';
    let containsYear = true;

    for (const datePattern of datePatterns) {
      results = matchDateAtBoundary(text, datePattern);
      if (results !== null) {
        const { day, month, year, found } = { ...results.groups };
        let tmp_year = year;

        if (tmp_year === undefined) {
          tmp_year = year ?? now.getFullYear();
          containsYear = false;
        }

        result = `${month}/${day}/${tmp_year}`;
        result = !isNaN(new Date(result).getTime()) ? result : `${day}/${month}/${tmp_year}`;
        result = !isNaN(new Date(result).getTime()) ? result : null;

        if (result !== null) {
          foundText = found;
          break;
        }
      }
    }

    if (result === null) {
      const monthRegex = new RegExp(`(^| )(${monthsRegexGroup} [0-9][0-9]?|[0-9][0-9]? ${monthsRegexGroup})`, 'ig');
      results = monthRegex.exec(text);
      result = results === null ? null : `${results[0]} ${now.getFullYear()}`.trim();
      foundText = results === null ? '' : results[0].trim();
      containsYear = false;
    }

    if (result === null) {
      return { foundText, date: null };
    }

    const date = new Date(result);
    if (isNaN(date.getTime())) {
      return { foundText, date: null };
    }

    if (!containsYear && date < now) {
      date.setFullYear(date.getFullYear() + 1);
    }

    return { foundText, date };
  }

  function addTimeToDate(text, date, previousMatch) {
    previousMatch = previousMatch?.trim() || '';
    text = replaceAll(text, previousMatch, '');
    if (previousMatch === null) {
      return { newText: text, date: null };
    }

    const timeRegex = ' (at|@) ([0-9][0-9]?(:[0-9][0-9])?( ?(a|p)m)?)';
    const matcher = new RegExp(timeRegex, 'ig');
    const results = matcher.exec(text);

    if (results !== null) {
      const time = results[2];
      const parts = time.split(':');
      let hours = parseInt(parts[0], 10);
      let minutes = 0;
      if (time.toLowerCase().endsWith('pm')) {
        if (hours !== 12) {
          hours += 12;
        }
      } else if (time.toLowerCase().endsWith('am') && hours === 12) {
        hours = 0;
      }
      if (parts.length > 1) {
        minutes = parseInt(parts[1], 10);
      }

      date.setHours(hours);
      date.setMinutes(minutes);
      date.setSeconds(0);
      date.setMilliseconds(0);
    }

    const replace = results !== null ? results[0] : previousMatch;
    return {
      newText: replaceAll(text, replace, '').trim(),
      date,
    };
  }

  function parseDate(text, now = new Date()) {
    if (matchesDateExpr(text, 'today')) {
      return addTimeToDate(text, getDateFromInterval(calculateDayInterval('today')), 'today');
    }
    if (matchesDateExpr(text, 'tonight')) {
      const taskDate = getDateFromInterval(calculateDayInterval('today'));
      taskDate.setHours(21);
      return addTimeToDate(text, taskDate, 'tonight');
    }
    if (matchesDateExpr(text, 'tomorrow')) {
      return addTimeToDate(text, getDateFromInterval(calculateDayInterval('tomorrow')), 'tomorrow');
    }
    if (matchesDateExpr(text, 'next monday')) {
      return addTimeToDate(text, getDateFromInterval(calculateDayInterval('nextMonday')), 'next monday');
    }
    if (matchesDateExpr(text, 'this weekend')) {
      return addTimeToDate(text, getDateFromInterval(calculateDayInterval('thisWeekend')), 'this weekend');
    }
    if (matchesDateExpr(text, 'later this week')) {
      return addTimeToDate(text, getDateFromInterval(calculateDayInterval('laterThisWeek')), 'later this week');
    }
    if (matchesDateExpr(text, 'later next week')) {
      return addTimeToDate(text, getDateFromInterval(calculateDayInterval('laterNextWeek')), 'later next week');
    }
    if (matchesDateExpr(text, 'next week')) {
      return addTimeToDate(text, getDateFromInterval(calculateDayInterval('nextWeek')), 'next week');
    }
    if (matchesDateExpr(text, 'next month')) {
      const date = new Date();
      date.setDate(1);
      date.setMonth(date.getMonth() + 1);
      date.setHours(calculateNearestHours(date));
      date.setMinutes(0);
      date.setSeconds(0);
      return addTimeToDate(text, date, 'next month');
    }
    if (matchesDateExpr(text, 'end of month')) {
      const curDate = new Date();
      const date = new Date(curDate.getFullYear(), curDate.getMonth() + 1, 0);
      date.setHours(calculateNearestHours(date));
      date.setMinutes(0);
      date.setSeconds(0);
      return addTimeToDate(text, date, 'end of month');
    }

    let parsed = getDateFromWeekday(text, now);
    if (parsed.date !== null) {
      return addTimeToDate(text, parsed.date, parsed.foundText);
    }

    parsed = getDayFromText(text, now);
    if (parsed.date !== null) {
      const month = getMonthFromText(text, parsed.date);
      return addTimeToDate(month.newText, month.date, parsed.foundText);
    }

    parsed = getDateFromTextIn(text, now);
    if (parsed.date !== null) {
      return addTimeToDate(text, parsed.date, parsed.foundText);
    }

    parsed = getDateFromText(text, now);

    if (parsed.date === null) {
      const time = addTimeToDate(text, new Date(now), parsed.foundText);

      if (time.date !== null && +now !== +time.date) {
        return time;
      }

      return {
        newText: replaceAll(text, parsed.foundText, ''),
        date: parsed.date,
      };
    }

    return addTimeToDate(text, parsed.date, parsed.foundText);
  }

  function parseTaskText(text, prefixesMode = PrefixMode.Default, now = new Date()) {
    const result = {
      text: text,
      date: null,
      labels: [],
      project: null,
      priority: null,
      assignees: [],
      repeats: null,
    };

    // If the entire text is wrapped in quotes, strip them and skip all parsing
    if (
      text.length >= 2 &&
      ((text.startsWith('"') && text.endsWith('"')) ||
        (text.startsWith("'") && text.endsWith("'")))
    ) {
      result.text = text.slice(1, -1);
      return result;
    }

    const prefixes = PREFIXES[prefixesMode];
    if (prefixes === undefined) {
      return result;
    }

    result.labels = getLabelsFromPrefix(text, prefixesMode) ?? [];
    result.text = cleanupItemText(result.text, result.labels, prefixes.label);

    result.project = getProjectFromPrefix(result.text, prefixesMode);
    result.text =
      result.project !== null
        ? cleanupItemText(result.text, [result.project], prefixes.project)
        : result.text;

    result.priority = getPriority(result.text, prefixes.priority);
    result.text =
      result.priority !== null
        ? cleanupItemText(result.text, [String(result.priority)], prefixes.priority)
        : result.text;

    result.assignees = getItemsFromPrefix(result.text, prefixes.assignee);

    const { textWithoutMatched, repeats } = getRepeats(result.text);
    result.text = textWithoutMatched;
    result.repeats = repeats;

    const { newText, date } = parseDate(result.text, now);
    result.text = newText;
    result.date = date;

    return cleanupResult(result, prefixes);
  }

  globalThis.QuickAdd = {
    PrefixMode,
    PREFIXES,
    parseTaskText,
    cleanupItemText,
  };
})();
