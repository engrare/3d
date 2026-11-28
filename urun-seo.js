/* Ürün sayfasındaki arama (SEO) içeriği: etiketler, sıkça sorulan sorular, sekme başlığı ve açıklaması.
   Yalnızca koddaki ürünler (1-5) için; panelden eklenen ürünlerde bölüm gizli kalır, başlık/açıklama genel biçimde üretilir.
   Metinler iş kurallarıyla tutarlı kalmalı (kargo, üretim süresi, iade: mevzuat/sss ve teslimat sayfaları).
   `{boyFiyat}` yer tutucusu sayfada güncel boy fiyatlarıyla doldurulur (myScript.js renderDetailExtras; fiyat panelden değişebilir).
   Bu dosya scripts/build-product-pages.js ile /urun/<ad>/ sayfalarına hazır HTML + JSON-LD olarak da basılır (JavaScript çalıştırmayan
   arama/yapay zekâ tarayıcıları için); metin değişince yayında kendiliğinden güncellenir. */
export const URUN_SEO = {
    1: {
        title: 'Araç İçi Telefon Numaratörü | Kişiye Özel 3D Baskı',
        description: 'Araç içi telefon numaratörü: numaranız sizin seçtiğiniz renkle, kişiye özel 3D baskıyla basılır. Ücretsiz kargo, 3-5 iş günü içinde kargoda.',
        tags: ['araç numaratörü', 'araba telefon numaratörü', 'araç içi numaralık', 'park numaratörü', 'kişiye özel numaratör', '3D baskı', 'arabaya hediye', 'oto aksesuar'],
        faq: [
            ['Numaratörde hangi bilgi yazılır?', 'Araç içinde görünmesini istediğiniz telefon numarası; ürün sayfasında numaranızı yazıp rengi seçtikçe canlı önizlemeyi görürsünüz.'],
            ['Rengi ve yazıyı seçebilir miyim?', 'Evet. Ürün sayfasındaki renk çiftlerinden birini seçersiniz; yazı ve renk siparişte seçtiğiniz gibi basılır.'],
            ['Ne zaman kargoya verilir?', 'Ürün siparişe özel basıldığı için standart üretimde 3-5 iş günü içinde, Öncelikli Üretim seçeneğinde 2-3 iş günü içinde kargoya verilir. Kargo Türkiye genelinde ücretsizdir; kargoda hasar ya da üretim hatası olursa ücretsiz yeniden basılır.'],
            ['Yanlış numara yazdım, değiştirebilir miyim?', 'Üretime başlanmadan önce bize WhatsApp veya e-postayla yazarsanız düzeltiriz. Kişiye özel basıldığı için üretimden sonra değişiklik yapılamaz; siparişten önce numarayı son kez kontrol edin.'],
            ['Numaramı gizleyebilir miyim?', 'Evet. Basarak açılıp kapanan mekanizması sayesinde numaranızı dilediğiniz zaman gizleyebilir, park ettiğinizde tek dokunuşla görünür hale getirebilirsiniz.'],
            ['Araca nasıl yerleştirilir?', 'Ön göğüste veya ön cam önünde kullanıma uygun kompakt gövdeye sahiptir; yüksek kontrastlı kabartma rakamları cam arkasından da net okunur.']
        ]
    },
    2: {
        title: 'Duvara Yapışmalı Kişiye Özel Ad Plakası | Kapı İsimliği',
        description: 'Kapı ve duvar için kişiye özel ad plakası ve isimlik: adınız, logonuz ve renginizle 3D baskı. Ücretsiz kargo, 3-5 iş günü içinde kargoda.',
        tags: ['ad plakası', 'kapı isimliği', 'kişiye özel isimlik', 'duvar isimliği', 'ofis kapı isimliği', 'logolu isimlik', '3D baskı', 'ev hediyesi'],
        faq: [
            ['Plakaya hangi yazı ve logo konabilir?', 'İsim ya da firma adınızı yazar, isterseniz logonuzu yüklersiniz (SVG, PNG, WebP veya JPEG, 5 MB’tan küçük). Arka planı saydam PNG/WebP ya da SVG en iyi sonucu verir.'],
            ['Duvara nasıl yapışır?', 'Plaka duvara yapışmalı olacak şekilde tasarlanmıştır; pürüzsüz ve temiz bir yüzeye uygulayın.'],
            ['Renk seçebilir miyim?', 'Evet. Ürün sayfasındaki renk çiftlerinden birini seçersiniz ve canlı önizlemede sonucu görürsünüz.'],
            ['Ne zaman kargoya verilir?', 'Standart üretimde 3-5 iş günü, Öncelikli Üretim seçeneğinde 2-3 iş günü içinde kargoya verilir; kargo ücretsizdir.']
        ]
    },
    3: {
        title: 'QR Kodlu Kartvizit Standı | Sosyal Medya & Masa Standı',
        description: 'Sosyal medya QR kodlu, kişiye özel kartvizit standı: Instagram, WhatsApp ve web sitenizi tek taramayla paylaşın. Ücretsiz kargo, 3-5 iş günü içinde kargoda.',
        tags: ['kartvizit standı', 'QR kodlu kartvizitlik', 'sosyal medya standı', 'QR masa standı', 'kişiye özel kartvizitlik', 'Instagram QR standı', 'işletme hediyesi', '3D baskı'],
        faq: [
            ['Standa hangi QR kodlar konabilir?', 'Instagram, WhatsApp, web siteniz gibi sosyal medya bağlantılarınız QR koda dönüştürülür; ürün sayfasında bağlantıyı girdikçe önizleme güncellenir. Logonuzu da ekleyebilirsiniz.'],
            ['Kartvizitlerle uyumlu mu?', 'Evet, standart kartvizitlerle (8.5 x 5.5 cm) uyumludur; bölme başına yaklaşık 40 kart alır.'],
            ['QR kod silinir mi, malzemesi nedir?', 'Hayır. Stand darbeye dayanıklı, yıkanabilir sert biyo-polimer (PLA) malzemeden üretilir. QR kod yüzeye yapıştırılmaz, 3D katmanlı olarak basılır; tüm telefon kameralarıyla anında okunur, silinmez ve soyulmaz.'],
            ['Ne zaman kargoya verilir?', 'Standart üretimde 3-5 iş günü, Öncelikli Üretim seçeneğinde 2-3 iş günü içinde kargoya verilir; kargo ücretsizdir. Kargoda hasar ya da üretim hatası olursa ücretsiz yeniden basılır.']
        ]
    },
    4: {
        title: 'Fotoğraftan Kişiye Özel 3D Büst | Yapay Zekâ ile 3D Önizleme',
        description: 'Fotoğrafını yükle, yapay zekâ 3D büstünü dakikalar içinde hazırlasın; ödeme yapmadan döndürerek önizle. Tek kişilik ya da sevgili, arkadaş için çift büst.',
        tags: ['fotoğraftan 3D büst', '3D portre büst', 'anında 3D önizleme', 'yapay zekâ ile büst', 'kişiye özel büst', 'çift büst', 'arkadaş büstü', 'sevgiliye hediye', 'yıldönümü hediyesi', '3D baskı figür'],
        faq: [
            ['Fotoğraftan 3D büst nasıl hazırlanıyor?', 'Fotoğrafınızı ürün sayfasına yüklersiniz; yapay zekâ fotoğraftan kaideli, stilize bir 3D büst modeli hazırlar. Sonucu aynı sayfada döndürerek görür, beğenirseniz sepete eklersiniz. Atölyemiz büstü 3D yazıcıda basıp kargoya verir.'],
            ['3D önizleme ne kadar sürede hazır olur?', 'Seçtiğiniz kaliteye göre yaklaşık 30 saniye ile 2,5 dakika arasında: hızlı modda 30-40 saniye, en kaliteli modda tek kişilik büst yaklaşık 1,5 dakika, çift büst yaklaşık 2,5 dakika. Önizleme ekranında beklerken sayfayı kapatsanız da üretim sürer; giriş yaparsanız büstleriniz hesabınıza da kaydedilir.'],
            ['Ödeme yapmadan önce görebilir miyim, denemek ücretli mi?', 'Evet, büstünüzü ödeme yapmadan önce 3D olarak döndürüp incelersiniz. Denemek ücretsizdir ve üyelik gerekmez (giriş yapmadan günde 3 deneme, üye girişiyle daha fazla). Yalnızca sepete eklediğiniz büst üretilir.'],
            ['Arkadaşımla ya da ailemle çift büst yaptırabilir miyim?', 'Evet. Çift büst, aynı fotoğraftaki iki kişiden yapılır: sevgililer, arkadaşlar, kardeşler ya da anne-çocuk. İki kişinin de yüzünün net göründüğü tek bir fotoğraf yükleyin; iki kişi algılandığında çift büst hazırlanır.'],
            ['Hangi fotoğraf uygundur?', 'Yüzün net göründüğü, iyi ışıkta çekilmiş, önden ya da hafif yandan bir fotoğraf en iyi sonucu verir. Çift büst için iki kişinin de göründüğü tek bir fotoğraf yükleyin.'],
            ['Büst fotoğraftaki gibi mi çıkar?', 'Büst fotoğrafınızdaki kişiye benzer ama stilize bir yorumdur, birebir kopya değildir. Sakal, dantel, ince saç telleri gibi çok küçük ayrıntılar 3D baskıda yumuşar. Sonuç beğenilmezse başka bir tane deneyebilir ya da farklı bir fotoğraf yükleyebilirsiniz.'],
            ['Büstün ölçüsü ve rengi ne?', 'Kaide dahil tek kişilik büst yaklaşık 9 cm, çift büst yaklaşık 10 cm boyundadır. Büst, seçtiğiniz tek baskı rengiyle (Kil Beyazı, Gri, Terrakota ya da Siyah) basılır.'],
            ['Hediye olarak başka bir adrese gönderebilir miyim?', 'Evet. Ödeme sayfasında teslimat adresine hediyeyi alacak kişinin adını ve adresini yazın, “Hediye olarak gönder” kutusunu işaretleyip karta yazılacak notu ve adınızı ekleyin. Büst doğrudan o adrese gönderilir.'],
            ['Kargoda kırılırsa ne olur?', 'Kargoda hasar ya da üretim hatası durumunda kargo tutanağı veya fotoğrafla bize ulaşmanız yeterlidir; büstünüz ücretsiz olarak yeniden basılıp gönderilir.'],
            ['Fotoğrafım ne olur?', 'Yalnızca büstünüzü hazırlamak için işlenir. Sipariş vermezseniz en geç 7 gün içinde silinir; sipariş verdiyseniz üretim ve iade süreleri için en fazla 120 gün saklanır.'],
            ['Ne zaman kargoya verilir?', 'Ürün siparişe özel basıldığı için standart üretimde 3-5 iş günü, Öncelikli Üretim seçeneğinde 2-3 iş günü içinde kargoya verilir; kargo ücretsizdir. Kişiye özel üretildiği için cayma hakkı kapsamı dışındadır.']
        ]
    },
    5: {
        title: 'Yapay Zekâ ile Kişiye Özel Renkli 3D Figür | Hayalindeki Karakter',
        description: 'Hayalindeki karakteri yaz ya da görselini yükle; yapay zekâ renkli, kaideli 3D figürünü tasarlasın, önizlemesini döndürerek gör, beğenirsen basalım. Ücretsiz kargo.',
        tags: ['3D figür', 'yapay zekâ figür', 'kişiye özel figür', 'renkli 3D baskı', 'karakter figürü', 'oyun karakteri figürü', 'masaüstü figür', 'hediye figür', 'arkadaşa hediye', 'oyuncak figür'],
        faq: [
            ['Figür nasıl hazırlanıyor?', 'Figürünüzü tek cümlelik bir tarifle (prompt) anlatırsınız ya da bir görsel yüklersiniz; yapay zekâ yaklaşık 2 dakikada renkli, kaideli bir 3D model hazırlar. Modeli ürün sayfasında döndürerek incelersiniz, beğenirseniz boyunu seçip sepete eklersiniz. Denemek ücretsizdir ve üyelik gerekmez (günde 3 tasarım); sayfayı kapatsanız da üretim arka planda sürer, giriş yaparsanız tasarımlarınız hesabınıza kaydedilir.'],
            ['Fiyatı ne kadar, boya göre değişiyor mu?', 'Evet, fiyat seçtiğiniz boya (kaide dahil yükseklik) göre değişir: {boyFiyat}. Fiyata kargo dahildir, ek ücret çıkmaz. Boyu tasarımdan sonra ürün sayfasında seçersiniz; sepette de değiştirebilirsiniz.'],
            ['Hangi boyu seçmeliyim?', '5 cm kibrit kutusu, 8 cm kredi kartının uzun kenarı, 10 cm çay bardağı, 15 cm telefon, 20 cm A4 kağıdın kısa kenarı kadardır. Masaüstü ve hediye için 8-10 cm en dengeli seçimdir; 5 cm’de yüz, parmak gibi ince ayrıntılar sadeleşir. Eni ve derinliği figürün şekline göre değişir.'],
            ['Oyun, film ya da çizgi film karakteri yaptırabilir miyim?', 'Telif hakları nedeniyle hazır bir karakterin birebir kopyasını basmıyoruz. Bunun yerine karakterin adını değil görünüşünü yazın (ör. “altın zırhlı, kalkanlı, kızıl saçlı kadın savaşçı”); yapay zekâ size oyun karakteri havasında özgün bir figür tasarlar. Gerçek kişilerin ve ünlülerin benzerini de istemeyin.'],
            ['Kaidesine isim ya da not yazdırabilir miyim?', 'Evet, ücretsiz. Figürünüzü tasarladıktan sonra WhatsApp’tan bize yazın; kaideye isim, tarih gibi kısa bir yazı ekleyip size özel sipariş bağlantısı göndeririz, fiyat değişmez. Yazı, kaidenin önüne kabartma olarak basılır.'],
            ['Boyalı mı, renkler nasıl veriliyor?', 'Boya kullanılmaz; figür doğrudan renkli PLA filamentle (Porima PLA) en çok 4 renkle basılır. Önizlemede gördüğünüz renkler basılacak renklerdir ve baskıdan önce ekibimiz modeli kontrol eder. Göz bebeği, ince çizgi gibi çok küçük renkli ayrıntılar en yakın renge karışabilir.'],
            ['Hangi görseli yükleyebilirim?', 'Tek bir karakterin ya da nesnenin olduğu, sade arka planlı bir görsel en iyi sonucu verir. Tarif yazarken de sahne/arka plan (orman, deniz) yazmayın. Telifli ya da ünlü karakterlerin ve gerçek kişilerin benzerini istemeyin. Yüklediğiniz görsel yalnızca figür için işlenir; siparişe dönmezse 7 gün içinde silinir.'],
            ['Arkadaşıma hediye olarak doğrudan gönderebilir miyim?', 'Evet. Figürü tasarlayıp beğendikten sonra sepete ekleyin; ödeme sayfasında teslimat adresine hediyeyi alacak kişinin adını ve adresini yazın, “Hediye olarak gönder” kutusunu işaretleyip karta yazılacak notu ve adınızı ekleyin. Figür doğrudan arkadaşınızın adresine gönderilir.'],
            ['Neredesiniz, kargo nasıl?', 'Atölyemiz İstanbul’dadır; Türkiye’nin her iline kargoyla gönderiyoruz ve kargo ücretsizdir. Kart (iyzico güvenli ödeme) ya da havale ile ödeyebilirsiniz.'],
            ['Kargoda kırılırsa ne olur?', 'Kargoda hasar ya da üretim hatası durumunda kargo tutanağı veya fotoğrafla bize ulaşmanız yeterlidir; figürünüz ücretsiz olarak yeniden basılıp gönderilir.'],
            ['Ne zaman kargoya verilir?', 'Figür siparişe özel basıldığı için standart üretimde 3-5 iş günü, Öncelikli Üretim seçeneğinde 2-3 iş günü içinde kargoya verilir; 15 ve 20 cm’de baskı daha uzun sürdüğünden 1-2 iş günü uzayabilir. Kişiye özel üretildiği için cayma hakkı kapsamı dışındadır.']
        ]
    }
};

/* Ortak HTML / JSON-LD üreticileri: ürün sayfası (myScript.js renderDetailExtras) ve yayın betiği (build-product-pages.js, /urun/<ad>/
   hazır HTML'i) AYNI çıktıyı üretsin diye burada. `boy` = {boyFiyat} yerine yazılacak metin (boysuz üründe boş). */
const seoEsc = (v) => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const boyYaz = (metin, boy) => metin.replace('{boyFiyat}', boy || '');

export const seoTagsHtml = (seo) => (seo && seo.tags ? seo.tags.map(t => `<span>${seoEsc(t)}</span>`).join('') : '');
export const seoFaqHtml = (seo, boy) => (seo && seo.faq ? seo.faq.map(([q, a]) => `<details class="faq-item"><summary>${seoEsc(q)}</summary><p>${seoEsc(boyYaz(a, boy))}</p></details>`).join('') : '');
// Google FAQPage yapısal verisi (görünen SSS ile birebir aynı metin)
export function seoFaqLd(seo, boy) {
    if (!seo || !seo.faq || !seo.faq.length) return null;
    return {
        '@context': 'https://schema.org', '@type': 'FAQPage',
        mainEntity: seo.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: boyYaz(a, boy) } }))
    };
}
// Ürünün içerik sayfası (arama motorlarına verilen asıl adres; build-product-pages.js yalnız koddaki ürünler (1-9) için üretir)
export const urunSayfaYolu = (p, slug) => (p && p.id < 10 ? `/urun/${slug}/` : `/?detail=${slug}`);
