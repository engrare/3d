/* 3D büst beklerken gösterilen esprili "yapay zeka" replikleri. Bir kez yazıldı, sabit kütüphane: her bekleyişte yapay zekaya sorulmaz.
   Aşamalar ilerleme çubuğuyla birlikte ilerler (sira -> kadraj -> sekil -> detay -> govde -> uc -> son -> gecikme); her aşamada replik rastgele seçilir,
   aynı aşamada tükenmeden tekrar etmez. `cift` yalnız iki kişilik büstte eklenir. Yeni replik = ilgili diziye satır ekle (portre.js'teki `portre-replik.js?v=` artır).
   Dil: kısa, sıcak, kimseyi kırmayan; sözler yapay zekanın ağzından (siparişle/teslimatla ilgili söz vermez). */

export const REPLIK = {
    // sırada bekleme / yükleme
    sira: [
        'Yapay zeka kahvesini yudumluyor, birazdan size bakacak.',
        'Fotoğrafınız kapıda sırasını bekliyor, ayakkabılarını da çıkardı.',
        'Atölyenin ışıklarını açıyoruz. Biraz tozlu, kusura bakmayın.',
        'Heykeltıraş yapay zeka eldivenlerini giyiyor. Eldiven yok ama jest önemli.',
        'Önünüzdeki büstler ünlü olmak için sabırsızlanıyor, siz de öyle.',
        'Önlüğünü bağlıyor, gözlüğünü takıyor… Gözü yok ama olsun.',
        'Sıra numaranızı cebine koydu. Merak etmeyin, kaybetmez, çünkü cebi yok.',
        'Kalıp makinesi ısınıyor. Isınma turu: bir şiir, iki şarkı.',
        'Yapay zeka parmaklarını çıtlatmaya çalışıyor. Parmağı olmadığı için biraz zorlanıyor.'
    ],
    // fotoğraf inceleniyor ve büst kadrajı
    kadraj: [
        'Fotoğrafınıza bakıyor… Güzel çıkmışsınız, dürüstçe söylüyorum, kimse beni zorlamadı.',
        'Gözler, burun, kulaklar… Eksik yok. Sayımı iki kez yaptık.',
        'Yüzünüzün hangi tarafı daha iyi diye ciddi bir jüri toplandı. Oy birliğiyle: hepsi.',
        'Yaklaşıyor, uzaklaşıyor, yine yaklaşıyor. Ressam ruhu.',
        'Saçlarınızdaki tellerin sayımına başlandı. Rakam çok çıktı, bırakıldı.',
        'Omuzlarınızı ölçüyor. Bu yapay zekada terzi ruhu da var.',
        'Arka planı nazikçe odadan çıkarıyor. Kanepe alınmasın.',
        'Işığı inceliyor. Fotoğrafı çeken kişiye selam, işini bilmiş.',
        'Gülümsemenizin üç boyutlu halinin nasıl olacağını düşünüyor. Heyecanlı.',
        'Kaşlarınıza bakıp "karakteri güçlü" diye not düştü.'
    ],
    // ham şekil: malzeme seçimi, kaba biçim
    sekil: [
        'Mermer mi, bronz mu, çikolata mı… Çikolata elendi, çünkü yapay zeka dayanamayıp yiyor.',
        'Hangi taşı kullanacağını seçiyor: mermer fazla soğuk, granit fazla ciddi, kaya fazla kaya.',
        'Burnunuz için kil, kulaklarınız için biraz sabır kullanılıyor.',
        'Yapay zeka çekicini kaldırdı… ama hologramdı, neyse ki kimse yaralanmadı.',
        'Yüzünüzün ana hatları çiziliyor. Çene çizgisi için ayrıca mesai yapılıyor.',
        'Alnınızı ne kadar geniş yapsak diye düşündü. Hayır, olduğu gibi kalacak, endişelenmeyin.',
        'Kil yoğruluyor. Eller temiz, hesap net.',
        'Baş kısmı tamam, şimdi boyun… Boyun hep ince iş.',
        'Rönesans ustalarından ilham alıyor. Onlar yıllar harcamıştı, bu bir dakikada hallediyor.',
        'Yapay zeka mermeri seçti, sonra "bunun baskısı olmaz ki" diyerek vazgeçti. Yeni taş arıyor.',
        'Büst için uygun poz aranıyor. Dik duruş mu, hafif yan mı? Seçim sizin yüzünüze bırakıldı.'
    ],
    // yüz ayrıntıları
    detay: [
        'Gözlerinizin içine bakıp biraz parlaklık ekliyor. Hani şu "ruh" denen şey.',
        'Kirpikler tek tek yerleştiriliyor. Tek tek, evet.',
        'Burun kanatlarında mikroskobik ince ayar yapılıyor.',
        'Gülümseme kıvrımları hizalanıyor. Sağ taraf biraz fazla mutlu çıktı, azaltıldı.',
        'Kulak memeleri… Evet, onlara da zaman ayırıyoruz.',
        'Saç tutamlarına yön veriliyor. Rüzgâr yok ama dramatik duruyor.',
        'Yanak çizgileri özenle işleniyor. Gamze varsa çıkarılmıyor, söz.',
        'Kaşlarınız çatık mı şaşkın mı diye bakıyor. Neyse, olduğu gibi bırakıldı.',
        'İmza için bir yer ayırıyor ama el yazısı kötü olduğu için vazgeçti.',
        'Dudak konturları titizlikle çiziliyor. Ruj yok, ayrıntı çok.'
    ],
    // boyun, omuz, kaide
    govde: [
        'Omuzlar geliyor. Dik durun, yapay zeka sizi görüyor.',
        'Boyundan omuza geçiş: bütün büst ustalarının korkulu rüyası.',
        'Kaideyi seçiyor: ahşap mı, taş mı… Sonunda sağlam ve dümdüz olanda karar kıldı.',
        'Büstünüzün düşmemesi için kaide sıkı sıkı tasarlanıyor. Yerçekimiyle pazarlık yok.',
        'Göğüs kısmını dolduruyor. Kıyafet ütülü, merak etmeyin.',
        'Kaideye isim yazsak mı diye düşündü, sonra "büst mü kapı zili mi" diyerek vazgeçti.',
        'Boynunuza bir yakıştırıp bir çıkarıyor, en iyisini arıyor.',
        'Büstünüz ayağa kalkıyor… yani oturuyor, ama gururla.'
    ],
    // üç boyutlu model, yüzey, kontrol
    uc: [
        'Üç boyuta geçiliyor. Artık arkası da var, arkanızı da düşünüyoruz.',
        'Milyonlarca küçük üçgen aynı anda çalışıyor. Sendika sorunu yok.',
        'Yüzeydeki pürüzler zımparalanıyor. Zımpara kâğıdı yok, matematik var.',
        'Büstün arkası için ayrı bir ekip kuruldu. Çoğu zaman ihmal edilir, burada edilmiyor.',
        'Delik var mı diye bakıyor. Büst delik deşik olmasın, sızdırmasın, ağlamasın.',
        'Her şey yerinde mi diye üç kez sayıyor: burun bir, kulaklar iki… Tamam.',
        'Büstü ters çeviriyor, düz çeviriyor, "iyi görünüyor" diyor. Tekrar ters çeviriyor.',
        'Üçgenler hizaya girdi. Disiplinli bir ordu gibi.'
    ],
    // son rötuşlar
    son: [
        'Son cilalamalar yapılıyor. Bez elde, çaba gözde.',
        'Toz alıyor, ışığı ayarlıyor, kameranın önüne geçen fotoğrafçıyı kenara çekiyor.',
        'Büstünüze son bir kez bakıp "tam sizsiniz" diyor. Biz de inandık.',
        'Kurdele kesilmeden önce son kontroller. Makas elinde, heyecanlı.',
        'Perde hazır, spot ışıkları açıldı. Büstünüz sahneye çıkmak üzere.',
        'Son ince ayar: bir tel saç daha, bir milim gülümseme.',
        'Yapay zeka alnındaki teri sildi. Terlemiyor ama jest güzel.',
        'Büstünüz son bir aynaya bakıyor. Kendinden memnun.',
        'Bitiyor bitiyor… Gerçekten bu sefer.'
    ],
    // beklenenden uzarsa
    gecikme: [
        'Biraz uzadı ama mükemmeliyet acele kabul etmez.',
        'Yapay zeka son bir detay daha buldu. Hep böyle yapar.',
        'Az kaldı. Gerçekten az. Bu sefer "az"ın tanımı değişmedi.',
        'Büstünüz hazır olmak istemiyor gibi: sanatçı gerginliği.',
        'Sabrınız için teşekkürler. Karşılığında bir gülümseme alabilir miyiz?',
        'Şu an iyice titiz modda; hepsi sizin için.',
        'Bazı büstler kolaydır, bazıları sanat. Sizinki sanat.'
    ],
    // yalnız iki kişilik büstte aşamalara eklenir
    cift: {
        sira: ['İki kişi, tek kaide: yapay zeka kimin sağda duracağı konusunda tarafsız kalmaya çalışıyor.'],
        kadraj: [
            'İkinizi aynı karede görünce kıskançlık krizi geçirmeden devam ediyor.',
            'Kim daha fotojenik diye bir sayım yapıldı, sonuç gizli tutuluyor.'
        ],
        sekil: [
            'İki yüz, iki karakter, bir heykeltıraş. Mesai uzayabilir.',
            'Aranızdaki mesafe ayarlanıyor: ne çok yakın ne çok uzak, tam sevgili mesafesi.'
        ],
        detay: [
            'Kim daha çok gülümsüyor diye kıl payı bir kontrol yapılıyor. Berabere.',
            'İkinizin gözlerindeki ışık eşitleniyor. Kıskançlık çıkmasın.'
        ],
        govde: [
            'Omuzlar yan yana, kimse kimseyi itmiyor. İyi çift.',
            'İkiniz de aynı kaideye sığıyor mu diye bakılıyor. Sığıyorsunuz, sıkılmayın.'
        ],
        uc: ['İkinizin arası kaideyle sabitlendi: artık hiçbir şey ayırmaz.'],
        son: ['Son cilayı iki kişi için iki kez yapıyor. Adil olmak lazım.'],
        gecikme: ['İki kişilik iş, iki kat titizlik. Az kaldı.']
    }
};

/* İlerleme çubuğu yüzdesine göre aşama (çubuk işçiden gelen yüzdeyle ve aşama içinde yavaşça ilerler) */
export function asamaBul(yuzde) {
    return yuzde < 14 ? 'kadraj' : yuzde < 36 ? 'sekil' : yuzde < 56 ? 'detay' : yuzde < 70 ? 'govde' : yuzde < 86 ? 'uc' : yuzde < 95 ? 'son' : 'gecikme';
}

/* Aşamadan, bu bekleyişte henüz gösterilmeyen bir replik seçer (hepsi gösterildiyse sıfırdan; üst üste aynı çıkmaz) */
export function sec(asama, cift, gosterilen) {
    const havuz = [...(REPLIK[asama] || []), ...(cift ? (REPLIK.cift[asama] || []) : [])];
    if (!havuz.length) return '';
    const kullanilan = gosterilen[asama] || (gosterilen[asama] = []);
    let kalan = havuz.filter((r) => !kullanilan.includes(r));
    if (!kalan.length) { const son = kullanilan[kullanilan.length - 1]; kullanilan.length = 0; kalan = havuz.filter((r) => r !== son); if (!kalan.length) kalan = havuz; }
    const r = kalan[Math.floor(Math.random() * kalan.length)];
    kullanilan.push(r);
    return r;
}
