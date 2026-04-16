const https = require("https");
function rq(host, port, path, body) {
  return new Promise(function(y, n) {
    var d = JSON.stringify(body);
    var r = https.request({ hostname: host, port: port, path: path, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(d) }
    }, function(s) {
      var t = ""; s.on("data", function(c) { t += c; });
      s.on("end", function() { try { y(JSON.parse(t)); } catch(e) { y({ _raw: t.slice(0, 300) }); } });
    });
    r.on("error", n); r.write(d); r.end();
  });
}
module.exports = async function(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  var AK = process.env.KIS_APP_KEY;
  var AS = process.env.KIS_APP_SECRET;
  if (!AK || !AS) return res.json({ error: "No keys", keyLen: AK ? AK.length : 0, secretLen: AS ? AS.length : 0 });
  var results = {};
  try {
    results.production = await rq("openapi.koreainvestment.com", 9443, "/oauth2/tokenP", {
      grant_type: "client_credentials", appkey: AK, appsecret: AS });
  } catch(e) { results.production = { error: e.message }; }
  try {
    results.vts = await rq("openapivts.koreainvestment.com", 29443, "/oauth2/tokenP", {
      grant_type: "client_credentials", appkey: AK, appsecret: AS });
  } catch(e) { results.vts = { error: e.message }; }
  results.keyInfo = { keyLength: AK.length, keyFirst4: AK.substring(0,4), secretLength: AS.length };
  res.json(results);
};
