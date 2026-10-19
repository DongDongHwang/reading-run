# 한글(.hwpx) 시 목록을 voice.html 안 POEMS-DATA 칸에 그대로 넣는 변환기 — 사용법. python build_poems.py <시목록.hwpx> [voice.html]
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

START = "<!-- POEMS-DATA-START"
END = "<!-- POEMS-DATA-END -->"


def hwpx_text(path):
	"""섹션 XML 의 최상위 문단을 줄로 꺼낸다. 빈 문단은 연 구분 빈 줄로 남긴다 (voice.html readHwpxText 와 같은 규칙)."""
	z = zipfile.ZipFile(path)
	names = sorted(
		(n for n in z.namelist() if re.fullmatch(r"Contents/section\d+\.xml", n)),
		key=lambda n: int(re.search(r"\d+", n).group()),
	)
	if not names:
		raise SystemExit("본문 섹션을 찾지 못했다 — .hwpx 파일이 맞는지 확인")
	lines = []
	for name in names:
		root = ET.fromstring(z.read(name))
		for p in root:
			if not p.tag.endswith("}p"):
				continue
			text = "".join(t.text or "" for run in p if run.tag.endswith("}run") for t in run if t.tag.endswith("}t"))
			lines.append(text.strip())
	return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def main():
	if len(sys.argv) < 2:
		raise SystemExit(__doc__ or "python build_poems.py <시목록.hwpx> [voice.html]")
	src = Path(sys.argv[1])
	html_path = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).with_name("voice.html")
	text = hwpx_text(src)
	html = html_path.read_text(encoding="utf-8")
	s, e = html.find(START), html.find(END)
	if s < 0 or e < 0:
		raise SystemExit("voice.html 에 POEMS-DATA 표시가 없다")
	# </script> 조기 종료를 막으려고 '<' 를 이스케이프한다
	payload = json.dumps(text, ensure_ascii=False).replace("<", "\\u003c")
	block = (
		f"{START} (build_poems.py 가 {src.name} 에서 자동 생성 — 직접 고치지 말 것) -->\n"
		f"<script>window.READING_RUN_POEMS = {payload};</script>\n"
	)
	html_path.write_text(html[:s] + block + html[e:], encoding="utf-8")
	titles = re.findall(r"^[<〈《](.+)[>〉》]$", text, flags=re.M)
	print(f"OK titles={len(titles)} lines={len([l for l in text.splitlines() if l.strip()])} chars={len(text)} -> {html_path}")


if __name__ == "__main__":
	main()
