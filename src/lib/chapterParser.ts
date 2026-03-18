/**
 * Parse chapter files in various formats.
 * Supported: Simple (timestamp + title), OGM, YouTube-style.
 */

export interface Chapter {
  start: number;
  end: number;
  title: string;
}

function timeToSeconds(time: string): number {
  const parts = time.replace(",", ".").split(":");
  if (parts.length === 2) {
    // M:SS or MM:SS
    return (parseFloat(parts[0]) || 0) * 60 + (parseFloat(parts[1]) || 0);
  }
  // HH:MM:SS or H:MM:SS
  const h = parseFloat(parts[0]) || 0;
  const m = parseFloat(parts[1]) || 0;
  const s = parseFloat(parts[2]) || 0;
  return h * 3600 + m * 60 + s;
}

/**
 * Parse a chapter file.
 * @param content - Raw chapter file text
 * @param videoDuration - Optional video duration to set the last chapter's end time
 */
export function parseChapters(
  content: string,
  videoDuration?: number
): Chapter[] {
  const lines = content
    .trim()
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (lines.length === 0) return [];

  // Detect OGM format: CHAPTER01=00:00:00.000
  if (/^CHAPTER\d+=/i.test(lines[0])) {
    return parseOGMChapters(lines, videoDuration);
  }

  return parseSimpleChapters(lines, videoDuration);
}

/** OGM chapter format: CHAPTER01=00:00:00.000 / CHAPTER01NAME=Title */
function parseOGMChapters(lines: string[], videoDuration?: number): Chapter[] {
  const chapters: Chapter[] = [];
  for (let i = 0; i < lines.length; i++) {
    const timeMatch = lines[i].match(/^CHAPTER\d+=(.+)/i);
    if (!timeMatch) continue;
    const start = timeToSeconds(timeMatch[1].trim());
    let title = `Chapter ${chapters.length + 1}`;
    if (i + 1 < lines.length) {
      const nameMatch = lines[i + 1].match(/^CHAPTER\d+NAME=(.+)/i);
      if (nameMatch) {
        title = nameMatch[1].trim();
        i++; // skip name line
      }
    }
    chapters.push({ start, end: 0, title });
  }
  setChapterEnds(chapters, videoDuration);
  return chapters;
}

/** Simple / YouTube-style: "HH:MM:SS Title" or "M:SS Title" */
function parseSimpleChapters(
  lines: string[],
  videoDuration?: number
): Chapter[] {
  const chapters: Chapter[] = [];
  for (const line of lines) {
    const match = line.match(
      /^(\d{1,2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?)\s+(.+)/
    );
    if (match) {
      chapters.push({
        start: timeToSeconds(match[1]),
        end: 0,
        title: match[2].trim(),
      });
    }
  }
  setChapterEnds(chapters, videoDuration);
  return chapters;
}

/** Fill in end times for chapters based on the next chapter's start */
function setChapterEnds(chapters: Chapter[], videoDuration?: number) {
  for (let i = 0; i < chapters.length - 1; i++) {
    chapters[i].end = chapters[i + 1].start;
  }
  if (chapters.length > 0) {
    chapters[chapters.length - 1].end =
      videoDuration || chapters[chapters.length - 1].start + 7200;
  }
}
