// 리딩런 판정·형광펜 로직 전수 테스트 — voice.html 안의 실제 함수(toSounds·matchProgress·anchorProgress·updateMatch 등)를 그대로 꺼내
// 시 30편·103연에 정독·잡담·오독·누락 입력을 넣어 돌린다. 브라우저·마이크 없이 node 로 실행한다.
//   node test_match.mjs [voice.html 경로]   → 기본 ./voice.html
//   node test_match.mjs --json out.json       → 연별 통과 판정을 파일로 (패치 전후 대조용)
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const jsonAt = args.indexOf("--json");
const jsonOut = jsonAt >= 0 ? args[jsonAt + 1] : null;
const textAt = args.indexOf("--text");
const textFile = textAt >= 0 ? args[textAt + 1] : null;   // 다른 시 목록(.txt, <제목> 줄 + 빈 줄 연 구분)으로 같은 시나리오를 돌린다
const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--json" && args[i - 1] !== "--text") || "voice.html";
const html = readFileSync(file, "utf-8");

// ---- voice.html 에서 순수 함수·상수만 꺼낸다 (DOM 없이 돌 수 있는 부분) ----
function grabConst(name) {
	const start = html.indexOf("\nconst " + name + " = ");
	if (start < 0) return "";
	// 문장 끝 = 「;」(뒤에 주석 허용)으로 끝나는 줄 가운데, 다음 줄이 들여쓰기로 시작하지 않는 첫 줄
	const lines = html.slice(start + 1).split("\n");
	const out = [];
	for (let i = 0; i < lines.length; i++) {
		out.push(lines[i]);
		if (/;\s*(\/\/.*)?$/.test(lines[i]) && !/^[\t ]/.test(lines[i + 1] || "")) return out.join("\n") + "\n";
	}
	throw new Error("const " + name + " 끝 못 찾음");
}
function grabFunction(name) {
	const start = html.indexOf("\nfunction " + name + "(");
	if (start < 0) return "";
	const end = html.indexOf("\n}\n", start);
	return html.slice(start + 1, end + 3);
}
const poemsRaw = html.match(/window\.READING_RUN_POEMS = ("(?:[^"\\]|\\.)*");<\/script>/)[1];
const consts = ["READABLE", "HEARD_WINDOW", "SHORT_MISS_ALLOWANCE", "END_SETTLE_SOUNDS", "END_SETTLE_MS",
	"ANCHOR_RUN", "ANCHOR_WINDOW", "ANCHOR_END_RUN", "ANCHOR_END_GAP", "ANCHOR_JUMP_RUN", "ANCHOR_GATE", "CUE_QUIET_MS", "CUE_MIN_CURSOR", "STUCK_MIN_READ", "STUCK_HEARD_RATIO",
	"CORRECTIONS", "TITLE_LINE", "CHO", "JUNG", "JONG", "SOUND", "JONG_SOUND"].map(grabConst).join("\n");
const funcs = ["applyCorrections", "normalize", "parsePoems", "toSounds", "recentSounds", "matchProgress",
	"anchorProgress", "lcsMatched", "missedChars", "updateMatch", "showCue"].map(grabFunction).join("\n");
const hasAnchor = funcs.includes("function anchorProgress(");

// updateMatch 가 부르는 바깥 것들은 가짜로 — DOM 대신 기록만 한다. 타이머는 실제처럼 걸어 두고, 「조용한 시간」이 오면 실행한다
const harness = `
${consts}
${funcs}
let state, para, log, timers, timerId;
function currentParagraph() { return para; }
function renderParagraph() { log.renders++; }
function setStatus(m) { log.status = m; }
function finishReading() { clearTimeout(state.settleTimer); clearTimeout(state.cueTimer); state.stuck = false; state.missed = null; log.finished = true; }
function setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; }
function clearTimeout(id) { timers.delete(id); }
function begin(text) {
	para = text;
	timers = new Map(); timerId = 0;
	log = { renders: 0, status: "", finished: false };
	state = { threshold: 0.8, turn: 1, playing: true, paused: false, settleTimer: null, cueTimer: null,
		confirmed: "", interim: "", matched: 0, hits: 0, soundPos: 0,
		cursor: 0, attemptHits: 0, shownHits: 0, attemptStart: 0, stuck: false, missed: null, finalPos: 0, peakPos: 0, peakHits: 0 };
}
// 말이 끊긴 뒤 조용함 — 걸려 있던 타이머 중 maxMs 이하인 것을 짧은 것부터 실행
function quiet(maxMs = Infinity) {
	for (const [id, t] of [...timers].sort((a, b) => a[1].ms - b[1].ms)) {
		if (!timers.has(id) || t.ms > maxMs) continue;
		timers.delete(id);
		t.fn();
	}
}
// Chrome 처럼 중간 결과가 자라다가 확정되는 흐름을 흉내 낸다. 끝나면 조용한 시간(pauseMs)을 준다
function speak(text, chunk = 4, pauseMs = Infinity) {
	const chars = Array.from(text);
	for (let i = chunk; i < chars.length; i += chunk) {
		if (log.finished) return;
		state.interim = chars.slice(0, i).join("");
		updateMatch();
	}
	if (log.finished) return;
	state.confirmed += text + " ";
	state.interim = "";
	updateMatch();
	quiet(pauseMs);
}
return { begin, speak, quiet, get state() { return state; }, get log() { return log; }, toSounds, normalize, parsePoems, applyCorrections,
	anchorProgress: typeof anchorProgress === "function" ? anchorProgress : null, missedChars: typeof missedChars === "function" ? missedChars : null };
`;
const V = new Function(harness)();
const text = textFile ? readFileSync(textFile, "utf-8") : V.applyCorrections(JSON.parse(poemsRaw));
const stanzas = V.parsePoems(text).flatMap(p => p.stanzas.map(s => ({ title: p.title, text: s })));
if (!textFile && stanzas.length !== 103) throw new Error("연 수 " + stanzas.length + " ≠ 103");
const N = stanzas.length;
console.log((textFile ? "글 = " + textFile : "글 = 내장 시 30편") + " · 연 " + N + "개");

// 결정론 난수 (패치 전후 같은 입력)
let seed = 20261019;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const SYL = Array.from({ length: 11172 }, (_, i) => String.fromCharCode(0xAC00 + i));
const misread = (t, rate) => Array.from(V.normalize(t)).map(ch => rnd() < rate ? SYL[Math.floor(rnd() * SYL.length)] : ch).join("");
const dropSyl = (t, rate) => Array.from(V.normalize(t)).filter(() => rnd() >= rate).join("");
const CHATTER = ["선생님 저요 저요", "야 조용히 해 봐", "이거 뭐예요 선생님", "화장실 가도 돼요", "아 몰라 재미없어", "다음은 누구 차례야",
	"선생님 오늘 급식 뭐예요 저는 돈까스가 좋아요 그리고 아까 쉬는 시간에 민수가 저를 밀었어요 진짜예요 제가 안 그랬어요"];

const results = {};   // 연별 게이트 결과 (패치 전후 대조)
const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); };
const pct = (a, b) => Math.round(a / b * 100);
const total = s => V.toSounds(s).sounds.length;
const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

// S1 정독 — 전부 자동 통과, 형광펜·%가 끝까지 가야 한다
let s1 = 0; const s1Shown = [];
for (const st of stanzas) {
	V.begin(st.text); V.speak(st.text);
	results["정독|" + st.title + "|" + st.text.slice(0, 10)] = V.log.finished;
	if (V.log.finished) s1++;
	check(!V.state.stuck, "정독인데 놓침 안내: " + st.title);
	if (hasAnchor) s1Shown.push(pct(V.state.shownHits, total(st.text)));   // finishReading 직전 상태의 표시 정확도
}
check(s1 === N, "정독 자동통과 " + s1 + "/" + N);
console.log(`S1 정독 자동통과 ${s1}/${N}` + (hasAnchor ? ` · 통과 직전 표시 정확도 중앙값 ${median(s1Shown)}% 최소 ${Math.min(...s1Shown)}%` : ""));

// S2 잡담만 — 통과 0, 형광펜 거의 0, 놓침 안내 0
let s2pass = 0, s2stuck = 0; const s2cur = []; const s2bad = [];
for (const st of stanzas) for (const c of CHATTER) {
	V.begin(st.text); V.speak(c);
	results["잡담|" + st.title + "|" + st.text.slice(0, 10) + "|" + c.slice(0, 6)] = V.log.finished;
	if (V.log.finished) s2pass++;
	if (V.state.stuck) s2stuck++;
	const shown = hasAnchor ? pct(V.state.cursor, total(st.text)) : pct(V.state.soundPos, total(st.text));
	s2cur.push(shown);
	if (shown >= 50) s2bad.push(`${shown}% ${st.title}「${st.text.split("\n")[0]}」← "${c}"`);
}
// 한 글자짜리 연(「와!」)은 같은 소리가 든 아무 말(「봐」「돼요」)로도 넘어간다 — 원래 코드도 같다. 소리 6개 미만 연만 예외로 센다
const tinyPass = stanzas.filter(st => total(st.text) < 6).length * CHATTER.length;
check(s2pass === 0 || (textFile && s2pass <= tinyPass), "잡담으로 통과 " + s2pass);
// 「다음은 누구 차례야」↔「내 마음의 손」 1연 「마음은 누가」 처럼 소리 7개가 우연히 그대로 겹치는 1건은 허용 (안내만 뜨고 통과는 안 함, 10-20 확인)
check(s2stuck <= 1, "잡담으로 놓침 안내 " + s2stuck);
console.log(`S2 잡담 ${N * CHATTER.length}건 → 통과 ${s2pass} · 놓침안내 ${s2stuck} · 형광펜 % 중앙값 ${median(s2cur)} · 최대 ${Math.max(...s2cur)} · 50% 넘는 건 ${s2bad.length}`);
for (const b of s2bad.slice(0, 8)) console.log("     " + b);
if (s2bad.length > 8) console.log("     … 외 " + (s2bad.length - 8) + "건");

// S3 절반 정독 뒤 긴 잡담 — 형광펜이 잡담으로 늘지 않아야 하고, 「다시」 안내가 뜨면 안 된다(읽다 멈춘 것뿐)
let s3jump = 0, s3stuck = 0;
for (const st of stanzas) {
	const n = V.normalize(st.text); const half = n.slice(0, Math.floor(n.length / 2));
	V.begin(st.text); V.speak(half);
	const before = hasAnchor ? V.state.cursor : V.state.soundPos;
	V.speak(CHATTER[6]);
	const after = hasAnchor ? V.state.cursor : V.state.soundPos;
	s3jump = Math.max(s3jump, pct(after - before, total(st.text)));
	if (V.state.stuck) s3stuck++;
	check(!V.log.finished, "절반+잡담 통과: " + st.title);
}
if (hasAnchor) check(s3jump <= 5, "절반 뒤 잡담 점프 " + s3jump + "%p");
console.log(`S3 절반 정독 뒤 긴 잡담 → 형광펜 최대 점프 +${s3jump}%p · 놓침안내 ${s3stuck}건`);

// S4 오독(음절 치환) 20%·30% — 통과 못 하면 놓침 안내 + 빨간 밑줄이 있어야 하고, 안내대로 처음부터 다시 읽으면 통과해야 한다
for (const rate of [0.2, 0.3]) {
	let pass = 0, stuck = 0, recovered = 0, noCue = 0; const spans = []; const overShown = [];
	for (const st of stanzas) {
		V.begin(st.text); const bad = misread(st.text, rate); V.speak(bad);
		results[`오독${rate}|` + st.title + "|" + st.text.slice(0, 10)] = V.log.finished;
		if (V.log.finished) { pass++; continue; }
		if (hasAnchor) {
			if (V.state.shownHits > V.state.hits) overShown.push(st.title);
			if (V.state.stuck) {
				stuck++; spans.push(V.state.missed.spans);
				check(V.state.missed.chars.size > 0 || V.state.missed.spans === 0, "밑줄 없는 안내: " + st.title);
				check(V.state.matched === 0 && V.state.cursor === 0, "안내 뒤 형광펜 초기화 안 됨: " + st.title);
				check(/처음부터 다시/.test(V.log.status), "안내 문구: " + V.log.status);
				V.speak(st.text);
				if (V.log.finished) recovered++; else check(false, "다시 읽어도 통과 못 함: " + st.title);
			} else noCue++;
		}
	}
	check(overShown.length === 0, "표시 정확도가 게이트보다 큼: " + overShown.join(","));
	console.log(`S4 오독 ${rate * 100}% → 자동통과 ${pass}/${N}` + (hasAnchor ? ` · 놓침안내 ${stuck}(밑줄 묶음 중앙값 ${spans.length ? median(spans) : "-"}) → 처음부터 재독 통과 ${recovered}/${stuck} · 안내 없이 멈춤 ${noCue}` : ""));
}

// S5 첫 단어 누락 · S6 음절 10% 누락 — 게이트는 패치 전과 같아야 한다(json 대조), 형광펜은 끝까지 가야 한다
let s5 = 0; const s6cur = []; let s6 = 0, s6stuck = 0;
for (const st of stanzas) {
	const words = st.text.trim().split(/\s+/);
	V.begin(st.text); V.speak(words.slice(1).join(" "));
	results["첫단어누락|" + st.title + "|" + st.text.slice(0, 10)] = V.log.finished;
	if (V.log.finished) s5++;
	V.begin(st.text); V.speak(dropSyl(st.text, 0.1));
	results["누락10|" + st.title + "|" + st.text.slice(0, 10)] = V.log.finished;
	if (V.log.finished) s6++;
	if (V.state.stuck) s6stuck++;
	s6cur.push(pct(hasAnchor ? V.state.cursor : V.state.soundPos, total(st.text)));
}
console.log(`S5 첫 단어 누락 통과 ${s5}/${N} · S6 음절 10% 누락 통과 ${s6}/${N} (놓침안내 ${s6stuck}) · 형광펜 % 중앙값 ${median(s6cur)} 최소 ${Math.min(...s6cur)}`);

// S7 안내가 뜬 뒤 — 형광펜이 0 에서 다시 자라야 한다 (처음부터 다시 읽는 진행 표시) + 작은 단위 점검
if (hasAnchor) {
	// 보통(80%) 기준은 다섯 줄 중 한 줄, 여덟 줄 중 두 줄 건너뛰기는 원래 통과시킨다(10-20 확인)
	// → 첫 줄·끝 줄만 읽고 가운데는 모두 엉뚱한 말 (어떤 시든 안내가 떠야 하는 상황)
	const st = stanzas.find(s => s.text.split("\n").length >= 5);
	const lines = st.text.split("\n");
	V.begin(st.text);
	V.speak(lines[0]); V.speak("선생님 저 이거 모르겠어요 진짜 하나도 모르겠어요"); V.speak(lines[lines.length - 1]);
	check(V.state.stuck, "S7 중간에 엉뚱한 말 뒤 안내가 안 뜸 (" + V.log.status + ")");
	check(V.state.matched === 0, "S7 안내 직후 형광펜이 0 이 아님");
	check(/처음부터 다시/.test(V.log.status), "S7 안내 문구: " + V.log.status);
	const spans7 = V.state.missed ? V.state.missed.spans : -1;
	const a = V.normalize(lines[0]).length, b = V.normalize(lines.slice(0, -1).join("")).length;
	const missedSkipped = V.state.missed && [...V.state.missed.chars].filter(i => i >= a && i < b).length;
	check(missedSkipped >= (b - a) * 0.6, "S7 건너뛴 줄 밑줄 부족 " + missedSkipped + "/" + (b - a));
	V.speak(lines[0]);
	check(V.state.cursor > 0 && V.state.matched > 0, "S7 다시 읽는데 형광펜이 안 자람");
	check(V.state.stuck && V.state.missed, "S7 밑줄이 재독 중 사라짐");
	V.speak(lines.slice(1).join(" "));
	check(V.log.finished, "S7 다시 읽어도 통과 못 함: " + V.log.status);
	console.log(`S7 「${st.title}」 가운데 ${lines.length - 2}줄 대신 엉뚱한 말 → 안내(밑줄 ${spans7}묶음, 건너뛴 ${b - a}자 중 ${missedSkipped}자) → 재독 진행 표시 → 통과`);
	// S9 절반 읽다가 옆에서 긴 잡담 → 진행이 리셋되지 않고, 이어서 나머지를 읽으면 통과해야 한다
	let s9 = 0, s9reset = 0;
	for (const st9 of stanzas) {
		const n9 = V.normalize(st9.text); const cut = Math.floor(n9.length / 2);
		V.begin(st9.text); V.speak(n9.slice(0, cut));
		const before = V.state.cursor;
		V.speak(CHATTER[6]);
		if (V.state.stuck || V.state.cursor < before) s9reset++;
		V.speak(n9.slice(cut));
		if (V.log.finished) s9++;
	}
	check(s9reset === 0, "S9 잡담으로 진행 리셋 " + s9reset);
	console.log(`S9 절반 읽다가 긴 잡담 → 진행 리셋 ${s9reset}건 · 이어서 나머지 읽고 통과 ${s9}/${N}`);
	const tiny = V.toSounds("바스락!");
	check(V.anchorProgress(tiny.sounds, V.toSounds("바스락").sounds).pos === tiny.sounds.length, "짧은 연 커서 끝 도달 실패");
	const t2 = V.toSounds("풀잎 위에");
	check(V.missedChars(t2, V.toSounds("풀잎 위에").sounds).spans === 0, "정독인데 밑줄");
	check(V.missedChars(t2, V.toSounds("불입 위에").sounds).spans === 0, "소리 같은 받아쓰기(풀잎→불입)인데 밑줄");
	check(V.missedChars(t2, V.toSounds("풀잎 아래").sounds).chars.size > 0, "오독인데 밑줄 없음");
}

// S10 교착 방지 — 많이 틀리게 읽은 뒤(안내가 뜨든 안 뜨든) 처음부터 제대로 다시 읽으면 반드시 통과해야 한다
if (hasAnchor) {
	const cases10 = [["오독30%", t => misread(t, 0.3)], ["첫 줄+잡담+끝 줄 일부", t => {
		const ls = t.split("\n"); const last = ls[ls.length - 1];
		return ls[0] + " 선생님 저 이거 모르겠어요 진짜 하나도 " + last.slice(0, Math.max(1, last.length - 3));
	}]];
	for (const [label, make] of cases10) {
		for (const pause of [500, Infinity]) {
			let ok = 0; const bad = [];
			for (const st of stanzas) {
				V.begin(st.text); V.speak(make(st.text), 4, pause);
				if (!V.log.finished) V.speak(st.text, 4, pause);
				if (V.log.finished) ok++; else bad.push(st.title + "「" + st.text.split("\n")[0] + "」");
			}
			check(ok === N, `S10 ${label} 뒤 재독(쉼 ${pause}ms) 통과 ${ok}/${N}: ` + bad.slice(0, 5).join(", "));
			console.log(`S10 ${label} → 쉼 ${pause === Infinity ? "길게" : pause + "ms"} → 처음부터 재독 통과 ${ok}/${N}`);
		}
	}
	// S11 끝말 바로 앞에서 잠깐(1초) 쉬었다 이어 읽기 — 리셋되면 안 된다
	let s11reset = 0, s11 = 0;
	for (const st of stanzas) {
		const n11 = V.normalize(st.text); const cut = Math.max(1, n11.length - 3);
		V.begin(st.text); V.speak(n11.slice(0, cut), 4, 1000);
		if (V.state.stuck) s11reset++;
		if (!V.log.finished) V.speak(n11.slice(cut), 4);
		if (V.log.finished) s11++;
	}
	check(s11reset === 0, "S11 끝말 앞 1초 쉼에 리셋 " + s11reset);
	check(s11 === N, "S11 끝말 앞 쉼 뒤 통과 " + s11);
	console.log(`S11 끝말 앞에서 1초 쉬고 이어 읽기 → 리셋 ${s11reset} · 통과 ${s11}/${N}`);
}

// S8 성능 — 가장 긴 연 + 3분치 잡담(≈3,000자모)에서 정독 1회 처리 시간
{
	const longest = stanzas.reduce((a, b) => total(a.text) > total(b.text) ? a : b);
	V.begin(longest.text);
	const noise = CHATTER.join(" ").repeat(12);
	V.state.confirmed = noise;
	const t0 = performance.now(); V.speak(longest.text, 6); const dt = performance.now() - t0;
	console.log(`S8 가장 긴 연「${longest.title}」(${total(longest.text)}자모) + 잡담 ${V.toSounds(noise).sounds.length}자모 → 정독 1회 처리 ${dt.toFixed(0)}ms`);
	check(dt < 2000, "성능 " + dt);
}

if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results, null, 1));
if (fails.length) { console.log("\n❌ 실패 " + fails.length + "건"); for (const f of fails.slice(0, 30)) console.log("  - " + f); process.exit(1); }
console.log("\n✅ 모든 점검 통과");
