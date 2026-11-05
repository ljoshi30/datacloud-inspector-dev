// TEST BUILD ONLY: gzip variant of the public bookmarklet. Not wired into build.js / install page.
// Reads bookmarklet.txt (uncompressed, the shipped one), writes bookmarklet-gzip.txt.
const fs = require("fs"), zlib = require("zlib");
const bm = fs.readFileSync("bookmarklet.txt", "utf8").trim().replace(/^javascript:/, "");
const m = bm.match(/^eval\(decodeURIComponent\(atob\(%22([^%]+)%22\)\)\)$/);
if (!m) throw new Error("unexpected bookmarklet shape");
const js = decodeURIComponent(Buffer.from(decodeURIComponent(m[1]), "base64").toString("binary"));
const gz = zlib.gzipSync(Buffer.from(js, "utf8"), { level: 9 }).toString("base64");
const loader = 'javascript:void(async function(){try{var a=atob("' + gz + '"),b=new Uint8Array(a.length),i=0;for(;i<a.length;i++)b[i]=a.charCodeAt(i);var t=await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream("gzip"))).text();(0,eval)(t)}catch(e){alert("Data 360 Inspector: compressed loader failed ("+e+"). Please use the standard (uncompressed) bookmarklet from the install page.")}}())';
fs.writeFileSync("bookmarklet-gzip.txt", loader);
console.log("uncompressed link:", bm.length + 11, "bytes | gzip link:", loader.length, "bytes | js:", js.length);
