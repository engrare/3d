/* Ürün sayfasındaki arama (SEO) içeriği: etiketler, sıkça sorulan sorular, sekme başlığı ve açıklaması.
   Yalnızca koddaki ürünler (1-5) için; panelden eklenen ürünlerde bölüm gizli kalır, başlık/açıklama genel biçimde üretilir.
   Metinler iş kurallarıyla tutarlı kalmalı (kargo, üretim süresi, iade: mevzuat/sss ve teslimat sayfaları).
   `{boyFiyat}` yer tutucusu sayfada güncel boy fiyatlarıyla doldurulur (myScript.js renderDetailExtras; fiyat panelden değişebilir). */
export const URUN_SEO = {
    1: {
        title: 'Araç İçi Telefon Numaratörü | Kişiye Özel 3D Baskı',
        description: 'Araç içi telefon numaratörü: numaranız sizin seçtiğiniz renkle, kişiye özel 3D baskıyla basılır. Ücretsiz kargo, 3-5 iş günü içinde kargoda.',
        tags: ['araç numaratörü', 'araba telefon numaratörü', 'araç içi numaralık', 'park numaratörü', 'kişiye özel numaratör', '3D baskı', 'arabaya hediye', 'oto aksesuar'],
        faq: [
            ['Numaratörde hangi bilgi yazılır?', 'Araç içinde görünmesini istediğiniz telefon numarası; ürün sayfasında numaranızı yazıp rengi seçtikçe canlı önizlemeyi görürsünüz.'],
            ['Rengi ve yazıyı seçebilir miyim?', 'Evet. Ürün sayfasındaki renk çiftlerinden birini seçersiniz; yazı ve renk siparişte seçtiğiniz gibi basılır.'],
            ['Ne zaman kargoya verilir?', 'Ürün siparişe özel basıldığı için standart üretimde 3-5 iş günü içinde, Öncelikli Üretim seçeneğinde 2-3 iş günü içinde kargoya verilir. Kargo Türkiye genelinde ücretsizdir.'],
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
            ['QR kod silinir mi, soyulur mu?', 'Hayır. QR kod yüzeye yapıştırılmaz, 3D katmanlı olarak basılır; silinmez ve soyulmaz.'],
            ['Ne zaman kargoya verilir?', 'Standart üretimde 3-5 iş günü, Öncelikli Üretim seçeneğinde 2-3 iş günü içinde kargoya verilir; kargo ücretsizdir.']
        ]
    },
    4: {
        title: 'Kişiye Özel 3D Portre Büst | Fotoğraftan 3D Baskı Büst',
        description: 'Fotoğrafınızı yükleyin, kaideli 3D baskı büstünüzü önizleyin, beğenirseniz üretelim. Tek kişilik ya da sevgililer için çift büst. Ücretsiz kargo.',
        tags: ['3D portre büst', 'fotoğraftan büst', 'kişiye özel büst', 'sevgiliye hediye', 'çift büst', 'fotoğraftan 3D figür', 'yıldönümü hediyesi', '3D baskı figür'],
        faq: [
            ['Büst nasıl hazırlanıyor?', 'Fotoğrafınızı yüklersiniz; yapay zekâ fotoğraftan kaideli, stilize bir 3D büst modeli hazırlar. Sonucu ürün sayfasında döndürerek görür, beğenirseniz sepete eklersiniz. Oluşturma birkaç dakika sürer.'],
            ['Hangi fotoğraf uygundur?', 'Yüzün net göründüğü, iyi ışıkta çekilmiş, önden ya da hafif yandan bir fotoğraf en iyi sonucu verir. Çift büst için iki kişinin de göründüğü tek bir fotoğraf yükleyin.'],
            ['Büst fotoğraftaki gibi mi çıkar?', 'Büst fotoğrafınızdaki kişiye benzer ama stilize bir yorumdur, birebir kopya değildir. Sakal, dantel, ince saç telleri gibi çok küçük ayrıntılar 3D baskıda yumuşar. Sonuç beğenilmezse başka bir tane deneyebilir ya da farklı bir fotoğraf yükleyebilirsiniz.'],
            ['Önizlemeyi beğenmezsem ne olur?', 'Ödeme yapmadan istediğiniz kadar (günlük hakkınız dahilinde) yeniden deneyebilirsiniz; yalnızca sepete eklediğiniz büst üretilir.'],
            ['Büstün ölçüsü ne kadar?', 'Kaide dahil tek kişilik büst yaklaşık 9 cm, çift büst yaklaşık 10 cm boyundadır. Büst, seçtiğiniz tek baskı rengiyle basılır.'],
            ['Kargoda kırılırsa ne olur?', 'Kargoda hasar ya da üretim hatası durumunda kargo tutanağı veya fotoğrafla bize ulaşmanız yeterlidir; büstünüz ücretsiz olarak yeniden basılıp gönderilir.'],
            ['Fotoğrafım ne olur?', 'Yalnızca büstünüzü hazırlamak için işlenir. Sipariş vermezseniz en geç 7 gün içinde silinir; sipariş verdiyseniz üretim ve iade süreleri için en fazla 120 gün saklanır.'],
            ['Ne zaman kargoya verilir?', 'Ürün siparişe özel basıldığı için standart üretimde 3-5 iş günü, Öncelikli Üretim seçeneğinde 2-3 iş günü içinde kargoya verilir; kargo ücretsizdir. Kişiye özel üretildiği için cayma hakkı kapsamı dışındadır.']
        ]
    },
    5: {
        title: 'Yapay Zekâ ile Kişiye Özel Renkli 3D Figür | Hayalindeki Karakter',
        description: 'Hayalindeki karakteri yaz ya da görselini yükle; yapay zekâ renkli, kaideli 3D figürünü tasarlasın, önizlemesini döndürerek gör, beğenirsen basalım. Ücretsiz kargo.',
        tags: ['3D figür', 'yapay zekâ figür', 'kişiye özel figür', 'renkli 3D baskı', 'karakter figürü', 'masaüstü figür', 'hediye figür', 'oyuncak figür'],
        faq: [
            ['Figür nasıl hazırlanıyor?', 'Figürünüzü birkaç kelimeyle anlatırsınız ya da bir görsel yüklersiniz; yapay zekâ yaklaşık 2 dakikada renkli, kaideli bir 3D model hazırlar. Modeli ürün sayfasında döndürerek incelersiniz, beğenirseniz boyunu seçip sepete eklersiniz. Denemek ücretsizdir ve üyelik gerekmez (günde 3 tasarım); beğenmezseniz yeniden deneyebilirsiniz.'],
            ['Fiyatı ne kadar, boya göre değişiyor mu?', 'Evet, fiyat seçtiğiniz boya (kaide dahil yükseklik) göre değişir: {boyFiyat}. Fiyata kargo dahildir, ek ücret çıkmaz. Boyu tasarımdan sonra ürün sayfasında seçersiniz; sepette de değiştirebilirsiniz.'],
            ['Hangi boyu seçmeliyim?', '5 cm kibrit kutusu, 8 cm kredi kartının uzun kenarı, 10 cm çay bardağı, 15 cm telefon, 20 cm A4 kağıdın kısa kenarı kadardır. Masaüstü ve hediye için 8-10 cm en dengeli seçimdir; 5 cm’de yüz, parmak gibi ince ayrıntılar sadeleşir. Eni ve derinliği figürün şekline göre değişir.'],
            ['Oyun, film ya da çizgi film karakteri yaptırabilir miyim?', 'Telif hakları nedeniyle hazır bir karakterin birebir kopyasını basmıyoruz. Bunun yerine karakterin adını değil görünüşünü yazın (ör. “altın zırhlı, kalkanlı, kızıl saçlı kadın savaşçı”); yapay zekâ size özgün bir figür tasarlar. Gerçek kişilerin ve ünlülerin benzerini de istemeyin.'],
            ['Boyalı mı, renkler nasıl veriliyor?', 'Boya kullanılmaz; figür doğrudan renkli PLA filamentle (Porima PLA) en çok 4 renkle basılır. Önizlemede gördüğünüz renkler basılacak renklerdir ve baskıdan önce ekibimiz modeli kontrol eder. Göz bebeği, ince çizgi gibi çok küçük renkli ayrıntılar en yakın renge karışabilir.'],
            ['Hangi görseli yükleyebilirim?', 'Tek bir karakterin ya da nesnenin olduğu, sade arka planlı bir görsel en iyi sonucu verir. Tarif yazarken de sahne/arka plan (orman, deniz) yazmayın. Telifli ya da ünlü karakterlerin ve gerçek kişilerin benzerini istemeyin. Yüklediğiniz görsel yalnızca figür için işlenir; siparişe dönmezse 7 gün içinde silinir.'],
            ['Neredesiniz, kargo nasıl?', 'Atölyemiz İstanbul’dadır; Türkiye’nin her iline kargoyla gönderiyoruz ve kargo ücretsizdir. Kart (iyzico güvenli ödeme) ya da havale ile ödeyebilirsiniz.'],
            ['Kargoda kırılırsa ne olur?', 'Kargoda hasar ya da üretim hatası durumunda kargo tutanağı veya fotoğrafla bize ulaşmanız yeterlidir; figürünüz ücretsiz olarak yeniden basılıp gönderilir.'],
            ['Ne zaman kargoya verilir?', 'Figür siparişe özel basıldığı için standart üretimde 3-5 iş günü, Öncelikli Üretim seçeneğinde 2-3 iş günü içinde kargoya verilir; 15 ve 20 cm’de baskı daha uzun sürdüğünden 1-2 iş günü uzayabilir. Kişiye özel üretildiği için cayma hakkı kapsamı dışındadır.']
        ]
    }
};
