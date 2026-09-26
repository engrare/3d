/* Ürün kataloğu — ana sayfa (myScript.js) ve ödeme sayfası (payment/myScript.js) ortak kullanır.
   Önceden ödeme sayfasında ayrı bir kopya vardı; eskiyip önizlemeleri bozuyordu.
   Görsel yolları site köküne göre ("./content/..."); ödeme sayfası resolveAssetPath ile çözüyor. */

// Yazı / zemin renk kombinasyonları (çapraz ikiye bölünmüş seçim balonları).
// Sunucu (functions/index.js > COLOR_COMBINATIONS) yalnızca bu çiftleri kabul eder.
export const COLOR_COMBINATIONS = [
    { color1: "#FBC02D", color2: "#222222", label1: "Yazı", label2: "Zemin" },
    { color1: "#FFFFFF", color2: "#1976D2", label1: "Yazı", label2: "Zemin" },
    { color1: "#222222", color2: "#FFFFFF", label1: "Yazı", label2: "Zemin" },
    { color1: "#E91E63", color2: "#388E3C", label1: "Yazı", label2: "Zemin" }
];

// --- BASİTLEŞTİRİLMİŞ ÜRÜN DATASI ---
export const products = [
    {
        id: 1,
        name: "Araba İçi Numaratör",
        desc: "Basarak aç kapa yapılabilen elegant numaratör.",
		customTextLabel: "araç içinde görünecek telefon numaranızı giriniz.",
		customTextPlaceholder: "Örn: 0541 555 55 55",
		customTextPlaceholderPreview: "0541 555 55 55",
		fixedTextSize: 48,
		fixedLogoSize: 48,
        price: 179.90,
        isDashedLine: false,
        images: [
            { src: "./content/products/1/3.jpg" },
            { src: "./content/products/1/2.jpg" },
            { src: "./content/products/1/1.jpg" },
            { src: "./content/products/1/4.jpg" }
        ],
        previewTextArea: { top: '33.0%', left: '13%', width: '74.2%', height: '16.6%' },
        colors: COLOR_COMBINATIONS,
    },
    {
        id: 2,
        name: "Duvara Yapışmalı Özel Ad Plakası",
        desc: "Kapı veya duvarlar için tasarlanmış isimlik.",
        price: 180,
        allowLogo: true,
        isDashedLine: false,
        images: [
            { src: "./content/products/2/1.jpg" },
            { src: "./content/products/2/2.jpg" },
            { src: "./content/products/2/3.jpg" },
            { src: "./content/products/2/4.jpg" }
        ],
        previewLogoArea: { top: '20.6%', left: '22.3%', width: '54.8%', height: '30.0%' },
        previewTextArea: { top: '49.2%', left: '22.3%', width: '54.8%', height: '30.8%' },
        colors: COLOR_COMBINATIONS,
    },
	{
        id: 3,
        name: "Kişiselleştirilmiş QR & Kartvizit Standı",
        desc: "İhtiyacınıza göre şekillenen profesyonel kartvizitlik.",
        price: 180,
        allowLogo: true,
        isDashedLine: false,
		/*  KÖŞE MATRİSİ — her alan 4 köşe, görseldeki yerleşimin aynısı.
		    Değerler önizleme kutusunun yüzdesi: [x, y]

		        ┌ sol üst     sağ üst ┐
		        └ sol alt     sağ alt ┘

		    Yukarı/aşağı kaydırmak: y değerlerini, sağa/sola: x değerlerini değiştirin.
		    Eğim vermek için tek bir köşeyi oynatmak yeterli.                        */
		isCustomObject: [
            {
                objectName: "1 Kartvizit Bölmeli",
                src: "./content/products/5/preview-1-bolme.png?v=2",
                previewLogoArea: { top: "19%", left: "47.8%", width: "30%", height: "21%" },
                previewSocialLogo1: [ /*┌*/ [16.9, 65.7], [25.3, 65.6], /*┐*/
                                      /*└*/ [16.6, 75.1], [25.3, 75.2]  /*┘*/ ],
                previewSocialQR1:   [ /*┌*/ [12.7, 78.4], [28.0, 78.4], /*┐*/
                                      /*└*/ [10.7, 92.2], [26.3, 92.3]  /*┘*/ ],
                previewSocialLogo2: [ /*┌*/ [32.2, 65.6], [41.0, 65.5], /*┐*/
                                      /*└*/ [32.2, 75.1], [41.0, 75.1]  /*┘*/ ],
                previewSocialQR2:   [ /*┌*/ [29.8, 78.4], [44.7, 78.4], /*┐*/
                                      /*└*/ [28.4, 92.2], [44.1, 92.5]  /*┘*/ ]
            },
            {
                objectName: "2 Kartvizit Bölmeli",
                src: "./content/products/5/preview-2-bolme.png?v=2",
                previewLogoArea: { top: "13%", left: "46%", width: "47%", height: "22%" },
                previewSocialLogo1: [ /*┌*/ [10.8, 62.5], [21.2, 62.5], /*┐*/
                                      /*└*/ [10.7, 73.4], [20.9, 73.8]  /*┘*/ ],
                previewSocialQR1:   [ /*┌*/ [ 5.8, 77.2], [25.1, 77.2], /*┐*/
                                      /*└*/ [ 2.8, 93.1], [23.0, 93.1]  /*┘*/ ],
                previewSocialLogo2: [ /*┌*/ [31.0, 62.5], [41.4, 62.5], /*┐*/
                                      /*└*/ [31.0, 73.4], [41.3, 73.4]  /*┘*/ ],
                previewSocialQR2:   [ /*┌*/ [27.5, 77.2], [46.5, 77.2], /*┐*/
                                      /*└*/ [25.7, 93.1], [45.7, 93.1]  /*┘*/ ]
            },
            {
                objectName: "3 Kartvizit Bölmeli",
                src: "./content/products/5/preview-3-bolme.png?v=2",
                previewLogoArea: { top: "15%", left: "49%", width: "40%", height: "25.5%" },
                previewSocialLogo1: [ /*┌*/ [13.1, 68.1], [21.1, 68.0], /*┐*/
                                      /*└*/ [12.7, 77.0], [21.1, 77.0]  /*┘*/ ],
                previewSocialQR1:   [ /*┌*/ [11.4, 78.4], [21.8, 78.4], /*┐*/
                                      /*└*/ [8.1, 92.1], [19.5, 92.4]  /*┘*/ ],
                previewSocialLogo2: [ /*┌*/ [28.5, 68.3], [37.2, 68.2], /*┐*/
                                      /*└*/ [28.5, 77.0], [37.2, 77.0]  /*┘*/ ],
                previewSocialQR2:   [ /*┌*/ [27.1, 78.4], [37.5, 79.3], /*┐*/
                                      /*└*/ [25.2, 91.7], [36.5, 91.4]  /*┘*/ ]
            }
        ],
		isCustomQR:  [
            { QR_Link: "1 Kartvizit Bölmeli", src: "./content/products/5/preview-1-bolme.png?v=2" },
            { QR_Link: "2 Kartvizit Bölmeli", src: "./content/products/5/preview-2-bolme.png?v=2" }
        ],
        colors: COLOR_COMBINATIONS,
        images: [
            { src: "./content/products/5/1.jpg" },
            { src: "./content/products/5/2.jpg" },
            { src: "./content/products/5/3.jpg" },
            { src: "./content/products/5/4.jpg" }
        ]
    }/*,
    {
        id: 3,
        name: "Araba Plaka Çerçevesi",
        desc: "Plakanızın dışına yüksek kalite ile basılmış logo ve yazı ekleyebildiğiniz çerçevenizi tasarlayın.",
        price: 180,
        images: [
            { src: "./content/products/3/1.jpg" },
            { src: "./content/products/3/2.jpg" },
            { src: "./content/products/3/3.jpg" },
            { src: "./content/products/3/4.jpg" }
        ],
        previewTextArea: { top: '15%', left: '10%', width: '80%', height: '70%' },
        previewLogoArea: { top: '15%', left: '10%', width: '80%', height: '70%' }
    },
    {
        id: 4,
        name: "Masaüstü USB'li fan",
        desc: "Renklerini seçebildiğiniz size özel fan.",
        price: 180,
        images: [
            { src: "./content/products/4/1.jpg" },
            { src: "./content/products/4/2.jpg" },
            { src: "./content/products/4/3.jpg" },
            { src: "./content/products/4/4.jpg" }
        ],
        previewTextArea: { top: '15%', left: '10%', width: '80%', height: '70%' },
        previewLogoArea: { top: '15%', left: '10%', width: '80%', height: '70%' }
    },
    {
        id: 6,
        name: "Özet Tasarım Anahtarlık",
        desc: "Üzerine isim yazdırılabilen dekoratif anahtarlık.",
		isCustomText: false,
		CustomColorText1: "Üst Renk",   // Renk seçici 1'in etiketi
		CustomColorText2: "Alt Renk",    // Renk seçici 2'nin etiketi
        price: 180,
        images: [
            { src: "./content/products/6/1.jpg" },
            { src: "./content/products/6/2.jpg" },
            { src: "./content/products/6/3.jpg" },
            { src: "./content/products/6/4.jpg" }
        ],
        previewTextArea: { top: '15%', left: '10%', width: '80%', height: '70%' },
        previewLogoArea: { top: '15%', left: '10%', width: '80%', height: '70%' }
    }*/
];
