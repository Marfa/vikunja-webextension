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

  // Shared with lib/vikunja.js (loaded before this file in popup.html) so the
  // "due today" default rounds to the same hour as a parsed date. The standalone
  // smoke harness loads lib/vikunja.js too.
  const calculateNearestHours = (currentDate = new Date()) =>
    globalThis.VikunjaLib.calculateNearestHours(currentDate);

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

  // Trims leading/trailing whitespace from a span into `text`, used to tighten
  // diff-derived date/repeat spans before remapping them to original-text
  // coordinates (see analyzeTaskText).
  function trimSpan(text, span) {
    if (span === null) return null;
    let start = span[0];
    let end = span[1];
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    if (start >= end) return null;
    return [start, end];
  }

  // Returns the [start, end] span of the characters removed between `before`
  // and `after`, where `after` is `before` with some characters deleted. Used
  // to recover token offsets for the preview chips without touching
  // parseTaskText.
  function diffRange(before, after) {
    let i = 0;
    let j = 0;
    let first = -1;
    let last = -1;
    while (i < before.length && j < after.length) {
      if (before[i] === after[j]) {
        i++;
        j++;
      } else {
        if (first === -1) first = i;
        last = i;
        i++;
      }
    }
    if (i < before.length) {
      if (first === -1) first = i;
      last = before.length - 1;
    }
    if (first === -1) return null;
    return [first, last + 1];
  }

  // Removes the characters in [start, end) from text (used to delete a chip).
  function removeSpan(text, start, end) {
    return text.slice(0, start) + text.slice(end);
  }

  // Location-aware companion to parseTaskText: recognizes the same tokens in
  // the same order but reports each token's display text plus its [start, end)
  // offsets into the ORIGINAL text, so the popup can render removable preview
  // chips. parseTaskText stays untouched.
  function analyzeTaskText(text, prefixesMode = PrefixMode.Default, now = new Date()) {
    const empty = () => ({
      project: null,
      priority: null,
      labels: [],
      assignees: [],
      date: null,
      repeats: null,
    });

    if (
      text.length >= 2 &&
      ((text.startsWith('"') && text.endsWith('"')) ||
        (text.startsWith("'") && text.endsWith("'")))
    ) {
      return empty();
    }

    const prefixes = PREFIXES[prefixesMode];
    if (prefixes === undefined) {
      return empty();
    }

    const result = empty();
    // `pt` mirrors the text parseTaskText sees at each stage; `removed` records
    // every consumed token's [start, end) in original-text coordinates so pt
    // offsets can be mapped back to the original text.
    let pt = text;
    const removed = [];

    const toOrig = (p) => {
      let out = p;
      let acc = 0;
      const sorted = removed.slice().sort((a, b) => a[0] - b[0]);
      for (const [s, e] of sorted) {
        if (p >= s - acc) {
          out += e - s;
          acc += e - s;
        }
      }
      return out;
    };

    const origSpan = (sp) => {
      if (sp === null) return null;
      const start = toOrig(sp[0]);
      const end = toOrig(sp[1] - 1) + 1;
      return [start, end];
    };

    const tokenPatterns = (prefix, name) => {
      const esc = escapeRegExp(name);
      return [
        `\\${prefix}'${esc}' `,
        `\\${prefix}'${esc}'`,
        `\\${prefix}"${esc}" `,
        `\\${prefix}"${esc}"`,
        `\\${prefix}${esc} `,
        `\\${prefix}${esc}`,
      ];
    };

    const locate = (patterns) => {
      for (const p of patterns) {
        const m = new RegExp(p, 'i').exec(pt);
        if (m !== null) return origSpan([m.index, m.index + m[0].length]);
      }
      return null;
    };

    const labelNames = getLabelsFromPrefix(pt, prefixesMode) ?? [];
    for (const name of labelNames) {
      const span = locate(tokenPatterns(prefixes.label, name));
      if (span === null) continue;
      removed.push(span);
      result.labels.push({ text: `${prefixes.label}${name}`, start: span[0], end: span[1] });
      pt = cleanupItemText(pt, [name], prefixes.label);
    }

    const projectName = getProjectFromPrefix(pt, prefixesMode);
    if (projectName !== null) {
      const span = locate(tokenPatterns(prefixes.project, projectName));
      if (span !== null) {
        removed.push(span);
        result.project = { text: `${prefixes.project}${projectName}`, start: span[0], end: span[1] };
        pt = cleanupItemText(pt, [projectName], prefixes.project);
      }
    }

    const priorityValue = getPriority(pt, prefixes.priority);
    if (priorityValue !== null) {
      const span = locate(tokenPatterns(prefixes.priority, String(priorityValue)));
      if (span !== null) {
        removed.push(span);
        result.priority = { text: `${prefixes.priority}${priorityValue}`, start: span[0], end: span[1] };
        pt = cleanupItemText(pt, [String(priorityValue)], prefixes.priority);
      }
    }

    const assigneeNames = getItemsFromPrefix(pt, prefixes.assignee);
    for (const name of assigneeNames) {
      const span = locate(tokenPatterns(prefixes.assignee, name));
      if (span !== null) {
        result.assignees.push({
          text: `${prefixes.assignee}${name}`,
          start: span[0],
          end: span[1],
        });
      }
    }

    const repeatBefore = pt;
    pt = getRepeats(pt).textWithoutMatched;
    const repeatSpan = diffRange(repeatBefore, pt);
    if (repeatSpan !== null) {
      const fullSpan = origSpan(repeatSpan);
      // The diff span in the current text can map across a previously removed
      // token (e.g. "Test !5 every day" → "every day" sits across the deleted
      // "!5 "), swallowing the token into the span. When that happens, trim
      // the whitespace from the pt-space span and remap so the span covers
      // only the repeat token.
      const straddled = removed.some(([s, e]) => fullSpan[0] < s && e < fullSpan[1]);
      let display = fullSpan;
      if (straddled) {
        const trimmed = trimSpan(repeatBefore, repeatSpan);
        if (trimmed !== null) display = origSpan(trimmed);
      }
      removed.push(fullSpan);
      result.repeats = {
        text: text.slice(display[0], display[1]).trim(),
        start: display[0],
        end: display[1],
      };
    }

    const dateBefore = pt;
    const dateSpan = diffRange(dateBefore, parseDate(pt, now).newText);
    if (dateSpan !== null) {
      let span = origSpan(dateSpan);
      // Same as repeats: a previously removed token between the title and the
      // date would otherwise be swallowed into the mapped span.
      if (removed.some(([s, e]) => span[0] < s && e < span[1])) {
        const trimmed = trimSpan(dateBefore, dateSpan);
        if (trimmed !== null) span = origSpan(trimmed);
      }
      result.date = {
        text: text.slice(span[0], span[1]).trim(),
        start: span[0],
        end: span[1],
      };
    }

    return result;
  }

  globalThis.QuickAdd = {
    PrefixMode,
    PREFIXES,
    parseTaskText,
    cleanupItemText,
    analyzeTaskText,
    removeSpan,
  };
})();
