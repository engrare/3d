/* Kütüphanesiz minimal .xlsx yazıcı (yönetici panelindeki "Excel" düğmesi; yalnızca düğmeye basınca import() ile yüklenir).
   buildXlsx([{ name, widths, rows }]) -> Blob. rows[0] başlık satırıdır (kalın, gri zemin, sabit, süzgeçli).
   Hücre: metin | sayı | { v, t: 'money' | 'date' } | boş. Tarih: ms (yerel saat olarak yazılır).
   Çıktı Excel, LibreOffice ve Google E-Tablolar'da açılır. Zip: CompressionStream varsa deflate, yoksa sıkıştırmasız. */

const enc = new TextEncoder();
const xmlEsc = (v) => String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const STYLE = { header: 1, money: 2, date: 3 };

function colName(i) {
    let n = '';
    for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) n = String.fromCharCode(65 + ((i - 1) % 26)) + n;
    return n;
}

function cellXml(cell, ref, isHeader) {
    if (cell === null || cell === undefined || cell === '') return '';
    if (isHeader) return `<c r="${ref}" s="${STYLE.header}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(cell)}</t></is></c>`;
    if (typeof cell === 'number') return Number.isFinite(cell) ? `<c r="${ref}"><v>${cell}</v></c>` : '';
    if (typeof cell === 'object') {
        const ms = Number(cell.v);
        if (!Number.isFinite(ms)) return '';
        if (cell.t === 'date') {
            const serial = (ms - new Date(ms).getTimezoneOffset() * 60000) / 86400000 + 25569;
            return `<c r="${ref}" s="${STYLE.date}"><v>${serial}</v></c>`;
        }
        return `<c r="${ref}" s="${STYLE.money}"><v>${ms}</v></c>`;
    }
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(cell)}</t></is></c>`;
}

function sheetXml(sheet) {
    const rows = sheet.rows || [];
    const width = Math.max(1, ...rows.map((r) => r.length));
    const cols = (sheet.widths || []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
    const data = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((c, ci) => cellXml(c, colName(ci) + (ri + 1), ri === 0)).join('')}</row>`).join('');
    const last = colName(width - 1) + Math.max(1, rows.length);
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${last}"/>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${data}</sheetData>${rows.length > 1 ? `<autoFilter ref="A1:${last}"/>` : ''}</worksheet>`;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="dd.mm.yyyy\\ hh:mm"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/* --- Zip (CRC32 + local/central header) --- */
const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
})();
function crc32(u8) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}
async function deflateRaw(u8) {
    if (typeof CompressionStream === 'undefined') return null;
    try {
        const stream = new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate-raw'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (e) { return null; }
}

async function zip(files) {
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
        const name = enc.encode(f.name);
        const raw = enc.encode(f.text);
        const packed = await deflateRaw(raw);
        const data = packed && packed.length < raw.length ? packed : raw;
        const method = data === raw ? 0 : 8;
        const crc = crc32(raw);
        const head = new DataView(new ArrayBuffer(30));
        head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint16(6, 0x0800, true); head.setUint16(8, method, true);
        head.setUint16(10, dosTime, true); head.setUint16(12, dosDate, true); head.setUint32(14, crc, true);
        head.setUint32(18, data.length, true); head.setUint32(22, raw.length, true); head.setUint16(26, name.length, true); head.setUint16(28, 0, true);
        parts.push(new Uint8Array(head.buffer), name, data);
        const cd = new DataView(new ArrayBuffer(46));
        cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true); cd.setUint16(10, method, true);
        cd.setUint16(12, dosTime, true); cd.setUint16(14, dosDate, true); cd.setUint32(16, crc, true);
        cd.setUint32(20, data.length, true); cd.setUint32(24, raw.length, true); cd.setUint16(28, name.length, true);
        cd.setUint32(42, offset, true);
        central.push(new Uint8Array(cd.buffer), name);
        offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((n, p) => n + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export async function buildXlsx(sheets) {
    const list = sheets.map((s, i) => ({ ...s, name: String(s.name || `Sayfa${i + 1}`).replace(/[\[\]:*?/\\]/g, ' ').slice(0, 31) }));
    const files = [
        { name: '[Content_Types].xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${list.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
        { name: '_rels/.rels', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
        { name: 'xl/workbook.xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${list.map((s, i) => `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
        { name: 'xl/_rels/workbook.xml.rels', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${list.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
        { name: 'xl/styles.xml', text: STYLES_XML },
        ...list.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text: sheetXml(s) }))
    ];
    return zip(files);
}
