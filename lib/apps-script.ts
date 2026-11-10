// The Google Apps Script a volunteer pastes into script.google.com, with
// their own token and this site's address filled in. Shown once on the edit
// page; nothing here is stored.
//
// What it does, every 10 minutes, in the volunteer's own Gmail:
// - searches the last 3 days for MEF / Blackboard mails with an
//   announcement keyword that it hasn't sent yet (no "mef-calendar" label),
// - cuts personal names out of greetings, sends each one to /api/ingest,
// - labels the thread "mef-calendar" once every message in it went through.
// The server checks the sender again and stores no mail text.

// Gmail search: {a b} means a OR b.
export const GMAIL_QUERY = [
  "newer_than:3d",
  "-label:mef-calendar",
  "{from:mef.blackboard.com from:mef.edu.tr}",
  '{iptal cancel cancelled canceled online uzaktan telafi "make-up" makeup extra "ek ders" sınav sinav vize midterm final exam quiz ertelendi postponed rescheduled derslik room yapılmayacak "no lab" "no labs" "no class" "no lecture"}',
].join(" ");

export function appsScriptSource({ apiUrl, token }: { apiUrl: string; token: string }): string {
  // String.raw keeps the script's backslashes (its regular expressions) as
  // written; JSON.stringify quotes the inserted values safely.
  return String.raw`// MEF Ders Takvimi — gönüllü script'i
//
// Bu hesaba gelen MEF / Blackboard duyurularından ders iptali, sınav, online
// ders gibi anahtar kelime içerenleri MEF Ders Takvimi'ne gönderir. Mailin
// metni orada saklanmaz; sadece içinden çıkan olay (ör. "COMP 201, 16 Kasım,
// lab iptal") kaydedilir. Gönderilen mailler "mef-calendar" etiketi alır.
//
// Bu kod SANA ÖZEL bir anahtar içeriyor: kimseyle paylaşma.
// Kurulum: üstteki fonksiyon listesinden "setup"ı seç ve Çalıştır'a bas.

var API_URL = ${JSON.stringify(apiUrl)};
var TOKEN = ${JSON.stringify(token)};
var LABEL = "mef-calendar";
var SEARCH = ${JSON.stringify(GMAIL_QUERY)};
var MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "run") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("run").timeBased().everyMinutes(10).create();
  run();
  Logger.log("Kurulum tamam: script artık her 10 dakikada bir çalışacak.");
}

function run() {
  var label = GmailApp.getUserLabelByName(LABEL) || GmailApp.createLabel(LABEL);
  var threads = GmailApp.search(SEARCH, 0, 30);
  var sent = 0;
  for (var i = 0; i < threads.length; i++) {
    var allOk = true;
    var messages = threads[i].getMessages();
    for (var j = 0; j < messages.length; j++) {
      var m = messages[j];
      if (Date.now() - m.getDate().getTime() > MAX_AGE_MS) continue;
      var res = UrlFetchApp.fetch(API_URL, {
        method: "post",
        contentType: "application/json",
        headers: { Authorization: "Bearer " + TOKEN },
        payload: JSON.stringify({
          messageId: m.getHeader("Message-ID") || null,
          from: m.getFrom(),
          subject: stripNames(m.getSubject()),
          body: stripNames(m.getPlainBody()).slice(0, 20000),
          sentAt: m.getDate().toISOString()
        }),
        muteHttpExceptions: true
      });
      var code = res.getResponseCode();
      if (code === 401) {
        Logger.log("Anahtar geçersiz: edit sayfandan yeni kod alıp buraya yapıştır.");
        return;
      }
      if (code === 200) sent++;
      else {
        allOk = false;
        Logger.log("Sunucu hatası (" + code + "), bir sonraki çalışmada tekrar denenecek.");
      }
    }
    if (allOk) threads[i].addLabel(label);
  }
  Logger.log("mef-calendar: " + sent + " mail gönderildi.");
}

// "Merhaba AD SOYAD," "Dear Ad Soyad," "Sayın Ad Soyad": the name is cut
// before the mail leaves Gmail. Group greetings ("Dear COMP 201 Students",
// "Değerli Öğrencilerim") are kept.
function stripNames(text) {
  var group = /student|öğrenci|ogrenci|\ball\b|everyone|herkes|arkadaş|arkadas|class|sınıf|sinif|[A-Z]{2,6} ?\d{3}/i;
  // The greeting must start a word ("this" is not "hi"); \b doesn't work
  // next to Turkish letters, hence the explicit class.
  return String(text || "")
    .replace(/(^|[^A-Za-zÇĞİÖŞÜçğıöşü])(merhaba|sayın|sayin|dear|hi|hello)([ \t]+)([^\n,.!:]{1,60})/gi, function (all, pre, hello, space, rest) {
      return group.test(rest) ? all : pre + hello;
    });
}
`;
}
