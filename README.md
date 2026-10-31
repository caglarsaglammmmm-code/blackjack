# Asil Blackjack

Telefonda dikey oynanan, tek kişilik, Türkçe Blackjack. Saf HTML, CSS ve JavaScript; çerçeve ve derleme adımı yok. Çevrimdışı çalışır ve ana ekrana eklenebilir. Gerçek para kullanılmaz.

## Bilgisayarda açma

`index.html` dosyasına çift tıklamak yeterlidir. Bu modda PWA özellikleri (kurulum, çevrimdışı) çalışmaz; onlar için sunucu gerekir.

Tarayıcılar `file://` üzerinde ES modül yüklemez. Bu yüzden çift tıklamada modüllerin birleştirilmiş kopyası `js/app.file.js` kullanılır. `js/` altında bir şey değiştirirseniz `npm run bundle` çalıştırın; `npm test` kopya eskiyse hata verir.

## Telefonda açma

### Yerel sunucu (aynı Wi-Fi)

Node.js kurulu bilgisayarda:

```
npm run serve
```

Ekranda yazan `http://192.168.x.x:8080` adresini telefondan açın. Oyun bu şekilde çalışır, ancak tarayıcılar service worker'ı yalnızca HTTPS veya localhost üzerinde çalıştırır. Yani ana ekrana kurulum ve çevrimdışı oyun için GitHub Pages yolunu kullanın.

Windows güvenlik duvarı sorarsa Node.js için özel ağ iznini verin.

### GitHub Pages (önerilen)

1. GitHub'da yeni bir depo oluşturun.
2. Bu klasörde:
   ```
   git init
   git add .
   git commit -m "Asil Blackjack"
   git branch -M main
   git remote add origin https://github.com/KULLANICI/DEPO.git
   git push -u origin main
   ```
   `.gitignore`, klasördeki Unity şablonunu depoya almaz.
3. Depoda **Settings > Pages > Source: Deploy from a branch**, dal `main`, klasör `/ (root)`.
4. Birkaç dakika sonra `https://KULLANICI.github.io/DEPO/` adresini telefonda açın.

### Ana ekrana ekleme

- **Android, Chrome:** menü > *Ana ekrana ekle* veya *Uygulamayı yükle*.
- **iPhone, Safari:** Paylaş > *Ana Ekrana Ekle*.

İlk açılıştan sonra internet olmadan da çalışır. Dosyaları güncellerseniz `sw.js` içindeki `CACHE` sürümünü artırın, yoksa telefonlar eski kopyayı kullanmaya devam eder.

## Kurallar

| Kural | Değer |
| --- | --- |
| Deste | 6, Fisher-Yates, karıştırma sonrası 1 kart yakılır |
| Kesme kartı | Yaklaşık %75 (234 ± 6 kart), el bitince karıştırılır |
| Krupiye | Soft 17 dahil 17'de durur, As veya 10 açıksa peek yapar |
| Blackjack | 3:2 |
| Sigorta | Bahsin yarısı, 2:1. Oyuncuda blackjack varken eşit para olarak sunulur |
| Double | İlk iki kartta herhangi bir toplamda, split sonrası serbest |
| Split | Aynı değerli kartlar (10-K dahil), en fazla 4 el |
| Split As | Her birine tek kart, yeniden split yok, 21 blackjack sayılmaz |
| Surrender | Late, yalnızca ilk iki kartta, split sonrası yok |
| Bahis | 10–5000 |

Şartnameye şu netleştirmeler eklendi:

- "Yeniden başla" ekranı bakiye 0 olunca değil, en küçük bahsin (10) altına düşünce çıkar. Teslim bakiyeyi 5'e düşürebilir.
- 21 olan el otomatik durur.
- Tüm eller bust veya teslim olduysa krupiye kart çekmez.

Temel strateji motorda oynatıldığında ev avantajı bu kural seti için beklenen aralıkta çıkar (test: `tests/strategy.test.js`).

## Dosyalar

```
index.html         Ekranlar
css/style.css      Tema ve yerleşim
js/game.js         Kural motoru (DOM yok)
js/strategy.js     Temel strateji tablosu
js/ui.js           Arayüz, motor olaylarını canlandırır
js/animations.js   Animasyon yardımcıları ve parçacıklar
js/audio.js        Web Audio sesleri ve titreşim
js/storage.js      localStorage, istatistik
js/app.file.js     Üretilmiş dosya, file:// için
tests/             Birim testleri
tools/             Yerel sunucu ve file:// paketleyici
fonts/             Cinzel ve Inter (SIL OFL)
manifest.json, sw.js, icons/   PWA
```

## Test

```
npm test
```

Node.js 20 veya üstü gerekir, başka bağımlılık yoktur.
