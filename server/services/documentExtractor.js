import { readFile } from 'fs/promises';
import pdf from 'pdf-parse';
import mammoth from 'mammoth';

/**
 * Extract text from a document. Returns { text, isImage, base64? }
 * If the PDF is scanned (no extractable text), returns it as base64 image
 * for Claude vision processing.
 */
export async function extractText(filePath, mimetype) {
  if (mimetype === 'application/pdf' || filePath.endsWith('.pdf')) {
    return extractPdf(filePath);
  }
  if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || filePath.endsWith('.docx')) {
    const text = await extractDocx(filePath);
    return { text, isImage: false };
  }
  if (mimetype?.startsWith('text/') || filePath.endsWith('.txt')) {
    const text = await readFile(filePath, 'utf-8');
    return { text, isImage: false };
  }
  if (mimetype?.startsWith('image/')) {
    const buf = await readFile(filePath);
    const base64 = buf.toString('base64');
    const mediaType = mimetype || 'image/jpeg';
    return { text: '[Scanned document image]', isImage: true, base64, mediaType };
  }
  throw new Error(`Unsupported file type: ${mimetype}`);
}

async function extractPdf(filePath) {
  const buf = await readFile(filePath);

  // Try text extraction first
  try {
    const data = await pdf(buf);
    const text = (data.text || '').trim();

    // If we got meaningful text (>50 chars), use it
    if (text.length > 50) {
      return { text, isImage: false };
    }
  } catch (e) {
    // pdf-parse failed, fall through to image mode
  }

  // Scanned PDF — send as base64 image for Claude vision
  const base64 = buf.toString('base64');
  return {
    text: '[Scanned PDF — sent as image for vision analysis]',
    isImage: true,
    base64,
    mediaType: 'application/pdf'
  };
}

async function extractDocx(filePath) {
  const buf = await readFile(filePath);
  const result = await mammoth.extractRawText({ buffer: buf });
  return result.value;
}
