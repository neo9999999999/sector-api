const https = require("https");
function rq(host, port, path, body) {
  return new Promise(function(y, n) {
    var d = JSON.stringify(body);
    var r = https.request({ hostname: host, port: port, path: path, method: "POST",
      headers: { "Content-Type": "application/json" }
    }, function(s) {
      var t = ""; s.on("data", function(c) { t += c; });
      s.on("end", function() { try { y(JSON.parse(t)); } catch(e) { y({ _raw: t.slice(0, 500) }); } });
    });
    r.on("error", n); r.write(d); r.end();
  });
}
module.exports = async function(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  var AK = process.env.KIS_APP_KEY || "";
  var AS = process.env.KIS_APP_SECRET || "";
  var keyChars = [];
  for (var i = 0; i < Math.min(AK.length, 10); i++) {
    keyChars.push({ pos: i, char: AK[i], code: AK.charCodeAt(i) });
  }
  var results = { keyLen: AK.length, secretLen: AS.length, keyChars: keyChars, keyFull: AK };
  try {
    results.token = await rq("openapi.koreainvestment.com", 9443, "/oauth2/tokenP", {
      grant_type: "client_credentials", appkey: AK, appsecret: AS });
  } catch(e) { results.token = { error: e.message }; }
  res.json(results);
};
