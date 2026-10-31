/* Tahmini kargoya veriliş tarihi: ana site (ürün, sepet) ve ödeme sayfası ortak kullanır.
   Standart üretim 3-5, öncelikli üretim 2-3 iş günüdür (backend sipariş PDF'i ve e-posta metinleriyle aynı). Hafta sonu ve resmî tatiller sayılmaz. */

const SHIP_DAYS = { standard: [3, 5], express: [2, 3] };
const CUTOFF_HOUR = 16; // 16:00'dan sonraki sipariş ertesi gün verilmiş sayılır

// Her yıl aynı gün olan resmî tatiller (ay-gün)
const FIXED_HOLIDAYS = ['01-01', '04-23', '05-01', '05-19', '07-15', '08-30', '10-29'];
// Dini bayramlar (yıl-ay-gün): yılda bir kontrol edilip yeni yıl eklenir; listede olmayan yıl yalnızca sabit tatillerle hesaplanır
const MOVING_HOLIDAYS = [
    '2026-03-20', '2026-03-21', '2026-03-22', '2026-05-27', '2026-05-28', '2026-05-29', '2026-05-30',
    '2027-03-09', '2027-03-10', '2027-03-11', '2027-05-16', '2027-05-17', '2027-05-18', '2027-05-19'
];

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

const pad = (n) => String(n).padStart(2, '0');
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function isBusinessDay(d) {
    const dow = d.getDay();
    if (dow === 0 || dow === 6) return false;
    const k = key(d);
    return !FIXED_HOLIDAYS.includes(k.slice(5)) && !MOVING_HOLIDAYS.includes(k);
}

/* Türkiye saatine göre şu an (tarayıcı saat dilimi farklı olsa da gün/saat doğru çıksın) */
function istanbulNow() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date());
    const get = (t) => Number(parts.find(p => p.type === t).value);
    return { date: new Date(get('year'), get('month') - 1, get('day')), hour: get('hour') };
}

function addBusinessDays(start, n) {
    const d = new Date(start);
    while (n > 0) {
        d.setDate(d.getDate() + 1);
        if (isBusinessDay(d)) n--;
    }
    return d;
}

/* "21–23 Ekim" / "21 Ekim" / "30 Ekim – 3 Kasım" */
function formatRange(a, b) {
    if (key(a) === key(b)) return `${a.getDate()} ${MONTHS[a.getMonth()]}`;
    if (a.getMonth() === b.getMonth()) return `${a.getDate()}–${b.getDate()} ${MONTHS[a.getMonth()]}`;
    return `${a.getDate()} ${MONTHS[a.getMonth()]} – ${b.getDate()} ${MONTHS[b.getMonth()]}`;
}

/* method: 'standard' | 'express' -> bugün sipariş verilirse tahmini kargoya veriliş aralığı */
export function shipEstimate(method = 'standard') {
    const [min, max] = SHIP_DAYS[method] || SHIP_DAYS.standard;
    const now = istanbulNow();
    const start = new Date(now.date);
    if (now.hour >= CUTOFF_HOUR) start.setDate(start.getDate() + 1);
    return formatRange(addBusinessDays(start, min), addBusinessDays(start, max));
}
