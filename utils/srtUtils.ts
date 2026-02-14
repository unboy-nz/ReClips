
export function generateSRT(script: string, totalDurationInSeconds: number): string {
  // Clean markdown and extra formatting
  const clean = script
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/~~/g, '')
    .replace(/`/g, '')
    .replace(/^- /gm, '');

  // Split by sentence terminators (Burmese || and standard . ! ?), also newline
  // Note: Burmese visual '။' (double vertical line) is the full stop.
  const segmentRegex = /[^.!?\n။]+[.!?\n။]*/g;
  const segments = clean.match(segmentRegex) || [clean];

  // Filter out empty whitespace chunks
  const chunks = segments
    .map(s => s.trim())
    .filter(s => s.length > 0);

  if (chunks.length === 0) return "";

  // Calculate total text "weight" (length) to distribute time proportionally
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  
  let currentTime = 0;
  let srtOutput = '';

  chunks.forEach((chunk, index) => {
    // Proportional duration calculation
    const weight = chunk.length / totalLength;
    const duration = weight * totalDurationInSeconds;
    
    const start = formatSRTTime(currentTime);
    const end = formatSRTTime(currentTime + duration);
    
    // SRT Index
    srtOutput += `${index + 1}\n`;
    // SRT Timecode
    srtOutput += `${start} --> ${end}\n`;
    // SRT Text
    srtOutput += `${chunk}\n\n`;
    
    currentTime += duration;
  });

  return srtOutput;
}

function formatSRTTime(seconds: number): string {
  const date = new Date(0);
  date.setMilliseconds(seconds * 1000);
  
  const hours = date.getUTCHours().toString().padStart(2, '0');
  const minutes = date.getUTCMinutes().toString().padStart(2, '0');
  const secs = date.getUTCSeconds().toString().padStart(2, '0');
  const ms = date.getUTCMilliseconds().toString().padStart(3, '0');
  
  return `${hours}:${minutes}:${secs},${ms}`;
}
