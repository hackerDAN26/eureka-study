// Turns picked files into message parts for the tutor. PDFs are read in the browser with
// pdf.js (text with page labels, so answers can cite "p. 4"); DOCX and PPTX are unzipped
// to text with slide labels; images are sent as images.
import JSZip from 'jszip';

let pdfjs = null;
async function loadPdf() {
  if (!pdfjs) {
    pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  }
  return pdfjs;
}

async function readPdf(file) {
  const lib = await loadPdf();
  const task = lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const pages = [];
  let chars = 0;
  for (let n = 1; n <= doc.numPages && chars < 400000; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    let text = '';
    for (const item of content.items) text += item.str + (item.hasEOL ? '\n' : ' ');
    text = text.replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
    chars += text.length;
    pages.push(`--- Page ${n} ---\n${text}`);
  }
  const total = doc.numPages;
  await (task.destroy?.() ?? doc.cleanup?.());
  return { text: pages.join('\n\n'), total, read: pages.length, empty: chars < 20 * Math.max(1, pages.length) };
}

const MAX_INLINE = 18 * 1024 * 1024;

const toBase64 = file =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

const xmlText = (xml, tag) => {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const paras = [...doc.getElementsByTagName(tag === 'w:t' ? 'w:p' : 'a:p')];
  return paras
    .map(p => [...p.getElementsByTagName(tag)].map(t => t.textContent).join(''))
    .filter(Boolean)
    .join('\n');
};

async function readOffice(file) {
  const zip = await JSZip.loadAsync(file);
  if (/\.docx$/i.test(file.name)) {
    const xml = await zip.file('word/document.xml')?.async('string');
    return xml ? xmlText(xml, 'w:t') : '';
  }
  const slides = Object.keys(zip.files)
    .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
  const out = [];
  for (const [i, name] of slides.entries()) {
    const text = xmlText(await zip.file(name).async('string'), 'a:t');
    out.push(`--- Slide ${i + 1} ---\n${text}`);
  }
  return out.join('\n\n');
}

export async function fileToPart(file, maxMB = 18) {
  const name = file.name;
  if (file.size > maxMB * 1024 * 1024) throw new Error(`${name} is over ${maxMB} MB — the limit on your plan.`);
  if (/\.(docx|pptx)$/i.test(name)) {
    const text = await readOffice(file);
    return { label: name, part: { text: `[Attached resource: ${name}]\n${text.slice(0, 400000)}` } };
  }
  if (file.type.startsWith('text/') || /\.(md|txt|csv|json|tex)$/i.test(name)) {
    const text = await file.text();
    return { label: name, part: { text: `[Attached resource: ${name}]\n${text.slice(0, 400000)}` } };
  }
  if (file.type === 'application/pdf' || /\.pdf$/i.test(name)) {
    const { text, total, read, empty } = await readPdf(file);
    if (empty) throw new Error(`${name} looks like a scanned PDF with no selectable text. Upload photos or screenshots of the pages instead.`);
    const note = read < total ? ` (first ${read} of ${total} pages)` : ` (${total} pages)`;
    return { label: name, part: { text: `[Attached resource: ${name}${note}]\n${text}` } };
  }
  if (file.type.startsWith('image/')) {
    if (file.size > MAX_INLINE) throw new Error(`${name} is over 18 MB — split it or upload a smaller file.`);
    const img = await shrinkImage(file);
    return {
      label: name,
      part: { inline_data: { mime_type: img.type, data: await toBase64(img) } },
      note: { text: `[Attached resource: ${name}]` }
    };
  }
  throw new Error(`${name}: this file type isn't supported yet. Use PDF, DOCX, PPTX, TXT, MD, CSV or an image.`);
}

// The AI accepts images up to ~4 MB (base64) and reads them at up to ~2000 px, so large
// photos are scaled down and re-encoded as JPEG in the browser first.
async function shrinkImage(file, maxSide = 2048, maxBytes = 2.8e6) {
  if (file.size <= maxBytes && !/heic|heif|tiff|bmp/i.test(file.type)) {
    try {
      const bmp = await createImageBitmap(file);
      const fits = Math.max(bmp.width, bmp.height) <= maxSide;
      bmp.close?.();
      if (fits) return file;
    } catch {
      return file;
    }
  }
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close?.();
    for (const q of [0.88, 0.75, 0.6]) {
      const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', q));
      if (blob && (blob.size <= maxBytes || q === 0.6)) return blob;
    }
  } catch {}
  return file;
}

export const ACCEPT = '.pdf,.docx,.pptx,.txt,.md,.csv,.json,image/*';

// The input must be in the page: Safari (especially on iPhone) won't open a picker for a
// detached file input.
export function pickFiles() {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = ACCEPT;
    input.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;opacity:0';
    let done = false;
    const finish = files => {
      if (done) return;
      done = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => finish([...(input.files ?? [])]));
    input.addEventListener('cancel', () => finish([]));
    document.body.appendChild(input);
    input.click();
  });
}
