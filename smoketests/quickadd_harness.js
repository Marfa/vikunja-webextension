'use strict';
const path = require('path');
global.chrome = { storage: { sync: { get: async () => ({}) } } };
require(path.join(__dirname, '..', 'lib/vikunja.js'));
require(path.join(__dirname, '..', 'lib/quick-add.js'));
const { parseTaskText, PrefixMode, analyzeTaskText, removeSpan } = globalThis.QuickAdd;

let pass = 0, fail = 0;
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; } else { fail++; console.error('FAIL', msg, '| got', a, '| want', e); }
}
function ok(cond, msg) {
  if (cond) { pass++; } else { fail++; console.error('FAIL', msg); }
}

const now = new Date();
now.setFullYear(2021, 5, 24);
const fmt = (d) => d === null || d === undefined ? null : `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const fmtT = (d) => d === null || d === undefined ? null : `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:${d.getMinutes()}`;

// --- Basic / modes / quotes ---
eq(parseTaskText('Lorem Ipsum').text, 'Lorem Ipsum', 'no intents');
eq(parseTaskText('Lorem Ipsum today *label +project !2 @user', PrefixMode.Disabled).text, 'Lorem Ipsum today *label +project !2 @user', 'disabled');
const t = parseTaskText('Lorem Ipsum today @label #project !2 +user', PrefixMode.Todoist);
eq(t.text, 'Lorem Ipsum  +user', 'todoist text');
eq(t.labels, ['label'], 'todoist labels');
eq(t.project, 'project', 'todoist project');
eq(t.priority, 2, 'todoist prio');
eq(t.assignees, ['user'], 'todoist assignees');
eq(parseTaskText('Lorem Ipsum email@example.com').text, 'Lorem Ipsum email@example.com', 'email ignored');
eq(parseTaskText('"delete mails up to january 30th"').text, 'delete mails up to january 30th', 'dq text');
eq(parseTaskText('"delete mails up to january 30th"').date, null, 'dq no date');
eq(parseTaskText("'buy mass tomorrow *label !2 @user'").text, 'buy mass tomorrow *label !2 @user', 'sq text');
ok(parseTaskText('"delete mails today').date !== null, 'unmatched quote parses');
ok(parseTaskText('"delete mails today\'').date !== null, 'mismatched quote parses');
ok(parseTaskText('delete "mails" today').date !== null, 'middle quotes parses');
eq(parseTaskText('""').text, '', 'empty quoted');
eq(parseTaskText('"task today @label #project"', PrefixMode.Todoist).text, 'task today @label #project', 'todoist quote escape');

// --- Date expressions ---
ok(parseTaskText('Lorem Ipsum ToDay').date !== null, 'ToDay');
ok(parseTaskText('Lorem Ipsum tonight').date.getHours() === 21, 'tonight 21');
const tmr = new Date(); tmr.setDate(tmr.getDate() + 1);
eq(fmt(parseTaskText('Lorem Ipsum tomorrow').date), fmt(tmr), 'tomorrow');
eq(fmt(parseTaskText('Lorem Ipsum Tomorrow').date), fmt(tmr), 'Tomorrow');

// today with a time
const timeCases = {
  'at 15:00': '15:0', '@ 15:00': '15:0', 'at 15:30': '15:30', '@ 3pm': '15:0',
  'at 3pm': '15:0', 'at 3 pm': '15:0', 'at 3am': '3:0', 'at 3:12 am': '3:12',
  'at 3:12 pm': '15:12', 'at 3:12 AM': '3:12', 'at 3:12 PM': '15:12',
  'at 3:12 Am': '3:12', 'at 3:12 Pm': '15:12', 'at 12:00 pm': '12:0', 'at 12:00 am': '0:0',
};
for (const [tc, expected] of Object.entries(timeCases)) {
  const r = parseTaskText(`Lorem Ipsum today ${tc}`);
  eq(`${r.date.getHours()}:${r.date.getMinutes()}`, expected, `today ${tc}`);
  eq(r.text, 'Lorem Ipsum', `today ${tc} text`);
}

// weekday date check
const nextThu = new Date(); nextThu.setDate(nextThu.getDate() + ((4 + 7 - nextThu.getDay()) % 7));
const thu = parseTaskText('Lorem Ipsum thu at 14:00');
eq(`${thu.date.getFullYear()}-${thu.date.getMonth()}-${thu.date.getDate()}`, `${nextThu.getFullYear()}-${nextThu.getMonth()}-${nextThu.getDate()}`, 'thu at 14:00');
eq(`${thu.date.getHours()}:${thu.date.getMinutes()}`, '14:0', 'thu time');

// --- Partial word / boundary regressions ---
const wordCases = ['renewed', 'github', 'fix monitor stand', 'order wedding cake', 'investigate thumping noise', 'iron frilly napkins', 'take photo of saturn', 'fix sunglasses', 'monitor blood pressure', 'Monitor blood pressure', 'buy almonds', 'Renovation', 'Remark', 'Renovation - 2nd Floor Bath', 'Remark - 13th floor', '13th floor - remark'];
for (const c of wordCases) {
  eq(parseTaskText(`${c} dolor sit amet`).text, `${c} dolor sit amet`, `word start ${c}`);
  eq(parseTaskText(`Lorem Ipsum ${c}`).text, `Lorem Ipsum ${c}`, `word end ${c}`);
  eq(parseTaskText(`Lorem Ipsum ${c} dolor`).text, `Lorem Ipsum ${c} dolor`, `word middle ${c}`);
  eq(parseTaskText(c).date, null, `word alone ${c}`);
}
for (const c of ['The 9/11 Report', 'The 01/02 Report', 'a]7/8 debate']) {
  eq(parseTaskText(c).text, c, `middle date ${c}`);
  eq(parseTaskText(c).date, null, `middle date null ${c}`);
}
eq(parseTaskText('The 1.2 formula').date, null, 'dot date middle');
eq(parseTaskText('Lorem Ispum v1.1.1').date, null, 'version');
eq(parseTaskText('https://some-url.org/blog/2019/1/233526-some-more-text').text, 'https://some-url.org/blog/2019/1/233526-some-more-text', 'url');

// boundary parse (now = 2021-06-24)
const boundaryTests = [
  { input: '9/11 meeting', dateStr: '2021-9-11', text: 'meeting' },
  { input: 'meeting 9/11', dateStr: '2021-9-11', text: 'meeting' },
  { input: 'meeting 9/11 at 10:00', dateStr: '2021-9-11', text: 'meeting' },
  { input: 'meeting 9/11 @ 15:00', dateStr: '2021-9-11', text: 'meeting' },
  { input: '2021-06-24 Lorem Ipsum', dateStr: '2021-6-24', text: 'Lorem Ipsum' },
  { input: 'Lorem Ipsum 06/26/2021', dateStr: '2021-6-26', text: 'Lorem Ipsum' },
  { input: '01.02 Lorem Ipsum', dateStr: '2022-2-1', text: 'Lorem Ipsum' },
  { input: 'Lorem Ipsum 01.02', dateStr: '2022-2-1', text: 'Lorem Ipsum' },
  { input: 'The 9/11 Report due 10/12', dateStr: '2021-10-12', text: 'The 9/11 Report due' },
];
for (const { input, dateStr, text } of boundaryTests) {
  const r = parseTaskText(input, PrefixMode.Default, now);
  eq(r.text.trim(), text, `boundary ${input} text`);
  eq(fmt(r.date), dateStr, `boundary ${input} date`);
}

// --- Date table ---
const dateTable = {
  '06/08/2021': '2021-6-8', '6/7/21': '2021-6-7', '27/07/2021,': null,
  '2021/07/06': '2021-7-6', '2021-07-06': '2021-7-6',
  '27 jan': '2022-1-27', '27/1': '2022-1-27', '27/01': '2022-1-27', '16/12': '2021-12-16',
  '01/27': '2022-1-27', '1/27': '2022-1-27', 'jan 27': '2022-1-27', 'Jan 27': '2022-1-27',
  'january 27': '2022-1-27', 'January 27': '2022-1-27',
  'feb 21': '2022-2-21', 'Feb 21': '2022-2-21', 'february 21': '2022-2-21', 'February 21': '2022-2-21',
  'mar 21': '2022-3-21', 'Mar 21': '2022-3-21', 'march 21': '2022-3-21', 'March 21': '2022-3-21',
  'apr 21': '2022-4-21', 'Apr 21': '2022-4-21', 'april 21': '2022-4-21', 'April 21': '2022-4-21',
  'may 21': '2022-5-21', 'May 21': '2022-5-21',
  'jun 21': '2022-6-21', 'Jun 21': '2022-6-21', 'june 21': '2022-6-21', 'June 21': '2022-6-21',
  '21st June': '2021-6-21', '2nd March': '2021-3-2', '2nd march': '2021-3-2', '3rd April': '2021-4-3',
  '1st January': '2021-1-1', '22nd December': '2021-12-22', '23rd October': '2021-10-23',
  '4th July': '2021-7-4', '15th August': '2021-8-15', '31st December': '2021-12-31',
  '5th Mar': '2021-3-5', '12th Sep': '2021-9-12',
  'jul 21': '2021-7-21', 'Jul 21': '2021-7-21', 'july 21': '2021-7-21', 'July 21': '2021-7-21',
  'aug 21': '2021-8-21', 'Aug 21': '2021-8-21', 'august 21': '2021-8-21', 'August 21': '2021-8-21',
  'sep 21': '2021-9-21', 'Sep 21': '2021-9-21', 'september 21': '2021-9-21', 'September 21': '2021-9-21',
  'oct 21': '2021-10-21', 'Oct 21': '2021-10-21', 'october 21': '2021-10-21', 'October 21': '2021-10-21',
  'nov 21': '2021-11-21', 'Nov 21': '2021-11-21', 'november 21': '2021-11-21', 'November 21': '2021-11-21',
  'dec 21': '2021-12-21', 'Dec 21': '2021-12-21', 'december 21': '2021-12-21', 'December 21': '2021-12-21',
  '01.02.2021': '2021-2-1', '01.02': '2022-2-1', '01.10': '2021-10-1', '01.02.25': '2025-2-1',
};
for (const [c, expected] of Object.entries(dateTable)) {
  const rEnd = parseTaskText(`Lorem Ipsum ${c}`, PrefixMode.Default, now);
  const rStart = parseTaskText(`${c} Lorem Ipsum`, PrefixMode.Default, now);
  eq(fmt(rEnd.date), expected, `date end ${c}`);
  eq(fmt(rStart.date), expected, `date start ${c}`);
  if (expected !== null) { eq(rEnd.text.trim(), 'Lorem Ipsum', `date end text ${c}`); eq(rStart.text.trim(), 'Lorem Ipsum', `date start text ${c}`); }
}

// --- Weekday recognition ---
const days = { monday: 1, mon: 1, tuesday: 2, tue: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, friday: 5, fri: 5, saturday: 6, sat: 6, sunday: 7, sun: 7 };
for (const [d, num] of Object.entries(days)) {
  for (const p of ['next ', '']) {
    const r = parseTaskText(`Lorem Ipsum ${p}${d}`);
    const next = new Date();
    const distance = (num + 7 - next.getDay()) % 7;
    next.setDate(next.getDate() + distance);
    eq(r.text, 'Lorem Ipsum', `weekday ${p}${d}`);
    eq(fmt(r.date), fmt(next), `weekday date ${p}${d}`);
    const rb = parseTaskText(`${p}${d} Lorem Ipsum`);
    eq(fmt(rb.date), fmt(next), `weekday start ${p}${d}`);
  }
  const t1 = `Lorem Ipsum ${d}ipsum`;
  eq(parseTaskText(t1).text, t1, `no space after ${d}`);
  eq(parseTaskText(t1).date, null, `no space after null ${d}`);
}

// --- in X ---
const fixedNow = new Date(2021, 5, 24, 12, 0, 0);
const inCases = {
  'Lorem Ipsum in 1 hour': '2021-6-24 13:0', 'in 2 hours': '2021-6-24 14:0',
  'in 1 day': '2021-6-25 12:0', 'in 2 days': '2021-6-26 12:0',
  'in 1 week': '2021-7-1 12:0', 'in 2 weeks': '2021-7-8 12:0', 'in 4 weeks': '2021-7-22 12:0',
  'in 1 month': '2021-7-24 12:0', 'in 3 months': '2021-9-24 12:0',
  'Something in 5 days at 10:00': '2021-6-29 10:0', 'Something 17th at 10:00': '2021-7-17 10:0',
  'Something sep 17 at 10:00': '2021-9-17 10:0', 'Something sep 17th at 10:00': '2021-9-17 10:0',
  'Something at 10:00 in 5 days': '2021-6-29 10:0', 'Something at 10:00 17th': '2021-7-17 10:0',
  'Something at 10:00 sep 17th': '2021-9-17 10:0', '2nd March at 5': '2021-3-2 5:0',
  '2nd March at 5pm': '2021-3-2 17:0', '2nd March @ 14:00': '2021-3-2 14:0',
  '3rd April at 10:30': '2021-4-3 10:30', '15th August @ 9am': '2021-8-15 9:0',
  '21st June at 18:45': '2021-6-21 18:45', '5th Mar at 3pm': '2021-3-5 15:0',
};
for (const [c, expected] of Object.entries(inCases)) {
  const r = parseTaskText(c, PrefixMode.Default, fixedNow);
  eq(fmtT(r.date), expected, `in: ${c}`);
}

// --- Labels ---
eq(parseTaskText('Lorem Ipsum *label1 *label2').labels, ['label1', 'label2'], 'two labels');
eq(parseTaskText('*label1 Lorem Ipsum *label2').labels, ['label1', 'label2'], 'labels from start');
eq(parseTaskText('Lorem Ipsum *label1 *label1 *label2').labels, ['label1', 'label2'], 'dedupe labels');
eq(parseTaskText("Lorem *'label with space' Ipsum").labels, ['label with space'], 'label space single quote');
eq(parseTaskText('Lorem *"label with space" Ipsum').labels, ['label with space'], 'label space double quote');
const l = parseTaskText('Lorem Ipsum *today');
eq(l.labels, ['today'], 'label today');
eq(l.date, null, 'label today no date');
eq(parseTaskText('a *"a (a)"').labels, ['a (a)'], 'label parens');
eq(parseTaskText('a *"a (a)"').text, 'a', 'label parens text');
eq(parseTaskText('*"a (a)" a').labels, ['a (a)'], 'label parens start');
eq(parseTaskText('*"a (a)" a').text, 'a', 'label parens start text');

// --- Project ---
eq(parseTaskText('Lorem Ipsum +project').project, 'project', 'project');
eq(parseTaskText("Lorem Ipsum +'project with long name'").project, 'project with long name', 'project space');
eq(parseTaskText('Lorem Ipsum +"project with long name"').project, 'project with long name', 'project space dq');
const p2 = parseTaskText('Lorem Ipsum +project1 +project2 +project3');
eq(p2.project, 'project1', 'first project');
eq(p2.text, 'Lorem Ipsum +project2 +project3', 'first project text');
eq(parseTaskText('Lorem Ipsum +today').project, 'today', 'project today');

// --- Priority ---
for (const pr of [0, 1, 2, 3, 4, 5]) {
  const r = parseTaskText(`Lorem Ipsum !${pr}`);
  eq(r.priority, pr, `priority ${pr}`);
  eq(r.text, 'Lorem Ipsum', `priority ${pr} text`);
}
eq(parseTaskText('Lorem Ipsum !9999').priority, null, 'invalid priority');
eq(parseTaskText('Lorem Ipsum !9999').text, 'Lorem Ipsum !9999', 'invalid priority text');
const pi = parseTaskText('Lorem Ipsum !9999 !1');
eq(pi.priority, 1, 'first valid priority');
eq(pi.text, 'Lorem Ipsum !9999', 'first valid priority text');

// --- Assignee ---
eq(parseTaskText('Lorem Ipsum @user').assignees, ['user'], 'assignee');
eq(parseTaskText('Lorem Ipsum @user1 @user2 @user3').assignees, ['user1', 'user2', 'user3'], 'three assignees');
eq(parseTaskText('Lorem Ipsum @user1 @user1 @user2').assignees, ['user1', 'user2'], 'dedupe assignees');
eq(parseTaskText("Lorem Ipsum @'user with long name'").assignees, ['user with long name'], 'assignee space');
eq(parseTaskText('Lorem Ipsum @"user with long name"').assignees, ['user with long name'], 'assignee space dq');
eq(parseTaskText('Lorem Ipsum @today').assignees, ['today'], 'assignee today');
eq(parseTaskText('Lorem Ipsum @email@example.com').assignees, ['email@example.com'], 'assignee email');

// --- Repeats ---
const repeatCases = {
  'every 1 hour': { type: 'hours', amount: 1 }, 'every hour': { type: 'hours', amount: 1 },
  'every 5 hours': { type: 'hours', amount: 5 }, 'every 12 hours': { type: 'hours', amount: 12 },
  'every day': { type: 'days', amount: 1 }, 'every 1 day': { type: 'days', amount: 1 },
  'every 2 days': { type: 'days', amount: 2 }, 'every week': { type: 'weeks', amount: 1 },
  'every 1 week': { type: 'weeks', amount: 1 }, 'every 3 weeks': { type: 'weeks', amount: 3 },
  'every month': { type: 'months', amount: 1 }, 'every 1 month': { type: 'months', amount: 1 },
  'every 2 months': { type: 'months', amount: 2 }, 'every year': { type: 'years', amount: 1 },
  'every 1 year': { type: 'years', amount: 1 }, 'every 4 years': { type: 'years', amount: 4 },
  'every one hour': { type: 'hours', amount: 1 }, 'every two hours': { type: 'hours', amount: 2 },
  'every three hours': { type: 'hours', amount: 3 }, 'every four hours': { type: 'hours', amount: 4 },
  'every five hours': { type: 'hours', amount: 5 }, 'every six hours': { type: 'hours', amount: 6 },
  'every seven hours': { type: 'hours', amount: 7 }, 'every eight hours': { type: 'hours', amount: 8 },
  'every nine hours': { type: 'hours', amount: 9 }, 'every ten hours': { type: 'hours', amount: 10 },
  'annually': { type: 'years', amount: 1 }, 'biannually': { type: 'months', amount: 6 },
  'semiannually': { type: 'months', amount: 6 }, 'biennially': { type: 'years', amount: 2 },
  'daily': { type: 'days', amount: 1 }, 'hourly': { type: 'hours', amount: 1 },
  'monthly': { type: 'months', amount: 1 }, 'weekly': { type: 'weeks', amount: 1 }, 'yearly': { type: 'years', amount: 1 },
};
for (const [c, expected] of Object.entries(repeatCases)) {
  const r = parseTaskText(`Lorem Ipsum ${c}`);
  eq(r.repeats && r.repeats.type, expected.type, `repeat ${c} type`);
  eq(r.repeats && r.repeats.amount, expected.amount, `repeat ${c} amount`);
  eq(r.text, 'Lorem Ipsum', `repeat ${c} text`);
  const r2 = parseTaskText(`Lorem Ipsum ${c} at 11:42`);
  eq(r2.repeats && r2.repeats.type, expected.type, `repeat ${c} at 11:42 type`);
  eq(r2.repeats && r2.repeats.amount, expected.amount, `repeat ${c} at 11:42 amount`);
  eq(`${r2.date.getHours()}:${r2.date.getMinutes()}`, '11:42', `repeat ${c} at 11:42 time`);
}
for (const c of ['annually', 'biannually', 'semiannually', 'biennially', 'daily', 'hourly', 'monthly', 'weekly', 'yearly']) {
  eq(parseTaskText(`Lorem Ipsum word${c}notword`).repeats, null, `word ${c}`);
  eq(parseTaskText(`Lorem Ipsum word${c}notword`).text, `Lorem Ipsum word${c}notword`, `word ${c} text`);
}

// --- repeatTaskFields: repeat tokens -> v2 repeat_after/repeat_mode ---
const { repeatTaskFields } = globalThis.QuickAdd;
eq(repeatTaskFields(null), null, 'repeat null -> null');
eq(repeatTaskFields({ amount: 0, type: 'days' }), null, 'repeat zero amount -> null');
eq(repeatTaskFields({ amount: 1, type: 'days' }), { repeat_after: 86400, repeat_mode: 0 }, 'every day -> seconds');
eq(repeatTaskFields({ amount: 3, type: 'weeks' }), { repeat_after: 1814400, repeat_mode: 0 }, 'every 3 weeks -> seconds');
eq(repeatTaskFields({ amount: 2, type: 'hours' }), { repeat_after: 7200, repeat_mode: 0 }, 'every 2 hours -> seconds');
eq(repeatTaskFields({ amount: 4, type: 'years' }), { repeat_after: 126144000, repeat_mode: 0 }, 'every 4 years -> seconds');
eq(repeatTaskFields({ amount: 2, type: 'months' }), { repeat_after: 0, repeat_mode: 1 }, 'every N months -> monthly mode');

// --- getDayFromText past-date edge cases (fixed now) ---
const jan = new Date(2022, 0, 15);
let r = parseTaskText(`Lorem Ipsum ${jan.getDate() - 1}th`, PrefixMode.Default, jan);
eq(r.date.getDate(), 14, '14th date');
eq(r.date.getMonth(), 1, '14th next month (feb)');
const mar = new Date(2022, 2, 32); // Mar 32 = Apr 1 2022
r = parseTaskText('Lorem Ipsum 31st', PrefixMode.Default, mar);
eq(r.date.getDate(), 31, '31st date');
eq(r.date.getMonth(), 4, '31st may');

// --- analyzeTaskText (token spans + removeSpan round-trip) ---
const at = (t, mode = PrefixMode.Default, n = now) => analyzeTaskText(t, mode, n);

eq(removeSpan('hello world', 0, 5), ' world', 'removeSpan start');
eq(removeSpan('hello world', 6, 11), 'hello ', 'removeSpan end');
eq(removeSpan('hello world', 5, 6), 'helloworld', 'removeSpan mid');

eq(at('Lorem Ipsum').project, null, 'at no project');
eq(at('Lorem Ipsum').labels, [], 'at no labels');
eq(at('Lorem Ipsum').assignees, [], 'at no assignees');
eq(at('Lorem Ipsum').priority, null, 'at no priority');
eq(at('Lorem Ipsum').date, null, 'at no date');
eq(at('Lorem Ipsum').repeats, null, 'at no repeats');

const a1 = at('Water plants +Home !3 *focus @alice tomorrow every day');
eq(a1.project.text, '+Home', 'at project text');
eq(a1.project.start, 'Water plants '.length, 'at project start');
eq(a1.project.end, 'Water plants +Home '.length, 'at project end');
eq(a1.priority.text, '!3', 'at priority text');
eq(a1.labels[0].text, '*focus', 'at label text');
eq(a1.assignees[0].text, '@alice', 'at assignee text');
eq(a1.date.text, 'tomorrow', 'at date text');
eq(a1.repeats.text, 'every day', 'at repeat text');

const q1 = at('buy *"a (a)" x');
eq(q1.labels[0].text, '*a (a)', 'at quoted label text');
eq(q1.labels[0].start, 'buy '.length, 'at quoted label start');
eq(q1.labels[0].end, 'buy *"a (a)" '.length, 'at quoted label end');

const od1 = at('*tomorrow tomorrow');
eq(od1.labels[0].text, '*tomorrow', 'at label-today label');
eq(od1.date.text, 'tomorrow', 'at label-today date');

eq(at('Lorem Ipsum *x today', PrefixMode.Disabled).labels, [], 'at disabled no labels');
eq(at('Lorem Ipsum *x today', PrefixMode.Disabled).date, null, 'at disabled no date');
eq(at('"delete mails today"').date, null, 'at quoted escape no date');
eq(at('"delete mails today"').labels, [], 'at quoted escape no labels');
eq(at('Lorem Ipsum !9999').priority, null, 'at invalid priority');
eq(at('Lorem Ipsum email@example.com').assignees, [], 'at email no assignee');

const t1 = at('#Home Water @label +alice !2', PrefixMode.Todoist);
eq(t1.project.text, '#Home', 'at todoist project');
eq(t1.labels[0].text, '@label', 'at todoist label');
eq(t1.assignees[0].text, '+alice', 'at todoist assignee');
eq(t1.priority.text, '!2', 'at todoist priority');

const b1 = at('The 9/11 Report due 10/12');
eq(b1.date.text, '10/12', 'at boundary date');
eq(b1.date.start, 'The 9/11 Report due'.length, 'at boundary date start');

// Removing every token span from the original must reproduce parseTaskText's
// cleaned title (assignees stay in the title, matching the parser).
const roundTrip = [
  'Water plants +Home !3 *focus @alice tomorrow every day',
  'buy milk *groceries today',
  'meeting 9/11 at 10:00 +Work',
  'Call Alice @bob in 2 days !2',
  'read +blog *article next monday',
];
for (const input of roundTrip) {
  const tokens = at(input);
  const spans = [];
  if (tokens.project) spans.push(tokens.project);
  if (tokens.priority) spans.push(tokens.priority);
  tokens.labels.forEach((t) => spans.push(t));
  if (tokens.date) spans.push(tokens.date);
  if (tokens.repeats) spans.push(tokens.repeats);
  spans.sort((x, y) => y.start - x.start);
  let out = input;
  for (const s of spans) out = removeSpan(out, s.start, s.end);
  eq(out.trim(), parseTaskText(input).text, `at roundtrip ${input}`);
}

// A removed token between the title and the date/repeat must not be swallowed
// into the mapped date/repeat span (regression: "Test !5 tomorrow" showed
// "!5 tomorrow" as the due-date chip).
const straddleCases = [
  { input: 'Test !5 tomorrow', date: 'tomorrow', repeat: null },
  { input: 'Test !5 today', date: 'today', repeat: null },
  { input: 'Test !5 at 15:00', date: 'at 15:00', repeat: null },
  { input: 'Water !3 tomorrow', date: 'tomorrow', repeat: null },
  { input: 'buy milk !2 in 2 days', date: 'in 2 days', repeat: null },
  { input: 'Call +Work !1 next monday', date: 'next monday', repeat: null },
  { input: 'Test *label tomorrow', date: 'tomorrow', repeat: null },
  { input: 'Test !5 every day', date: null, repeat: 'every day' },
  { input: 'Test !5 every day tomorrow', date: 'tomorrow', repeat: 'every day' },
  { input: 'every day !5 tomorrow', date: 'tomorrow', repeat: 'every day' },
  { input: 'tomorrow !5 Test', date: 'tomorrow', repeat: null },
];
for (const { input, date, repeat } of straddleCases) {
  const a = at(input);
  const slice = (o) => (o === null ? null : input.slice(o.start, o.end).trim());
  eq(slice(a.date), date, `straddle ${input} date span`);
  eq(slice(a.repeats), repeat, `straddle ${input} repeat span`);
  // Removing just the date/repeat span must keep the preceding magic token.
  const tokenBefore = a.project || a.priority || a.labels[0];
  if (a.date !== null) {
    const out = removeSpan(input, a.date.start, a.date.end);
    ok(out.includes(tokenBefore.text), `straddle ${input} date removal keeps ${tokenBefore.text}`);
  }
  if (a.repeats !== null) {
    const out = removeSpan(input, a.repeats.start, a.repeats.end);
    ok(out.includes(tokenBefore.text), `straddle ${input} repeat removal keeps ${tokenBefore.text}`);
  }
}
// todoist mode: same swallowing issue applies
const td1 = at('#Home !2 tomorrow', PrefixMode.Todoist);
eq('#Home !2 tomorrow'.slice(td1.date.start, td1.date.end).trim(), 'tomorrow', 'todoist straddle date span');
ok(removeSpan('#Home !2 tomorrow', td1.date.start, td1.date.end).includes('#Home'), 'todoist straddle keeps project');

// The "due today" default must round to the same hour as a parsed date.
// Both go through VikunjaLib.calculateNearestHours.
{
  const { calculateNearestHours, dueTodayISO } = globalThis.VikunjaLib;
  for (const t of ['09:00', '09:01', '12:00', '12:30', '15:00', '15:30', '18:00', '18:30', '21:00', '21:30']) {
    const d = new Date('2026-08-03T' + t + ':00');
    const expected = new Date(d);
    expected.setHours(calculateNearestHours(d), 0, 0, 0);
    eq(dueTodayISO(d), expected.toISOString(), 'dueTodayISO hour ' + t);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
