// Behavior: the user's real query (leading comment + trailing ";" + LIMIT) must reach the server as ONE clean statement.
const fs=require("fs"),assert=require("assert");
const src=fs.readFileSync(__dirname+"/../console-decorate.extension.js","utf8");
const a=src.indexOf("    function qeCleanForRun"), b=src.indexOf("    function qeFetchExport");
const clean=new Function(src.slice(a,b)+";return qeCleanForRun;")();
const q=`-- lineage company/ commercial profiles 

SELECT p."contact_key__c", p."commercial_in__c",

i."Id__c" AS individual_id,
ul."SourceRecordId__c"

FROM "TDI_RH_Profile__dll" p

LEFT JOIN "TDI_Individual__dlm" i ON p."contact_key__c" = i."Id__c" AND ul."DataSourceId__c" = 'SFTP_TDI_GI_TIBCO_Profile'

WHERE p."contact_active_in__c" = 'TRUE' AND p."contact_first_name__c" = '' AND p."contact_last_name__c" = '' 

LIMIT 10;`;
const c=clean(q);
assert(!/--/.test(c),"comment removed"); assert(!/;/.test(c),"no semicolon"); assert(/^SELECT/.test(c),"starts with SELECT");
assert(/= '' AND p\."contact_last_name__c" = ''/.test(c),"empty-string literals preserved");
assert(/'SFTP_TDI_GI_TIBCO_Profile'/.test(c),"string literal preserved");
const base=c.replace(/\bOFFSET\s+\d+\s*$/i,"").trim().replace(/\bLIMIT\s+\d+\s*$/i,"").trim();
assert(!/LIMIT/i.test(base),"trailing LIMIT stripped (was NOT before the fix)");
assert(clean("SELECT '--x;' AS a FROM t /* c */ ;")==="SELECT '--x;' AS a FROM t","'--' and ';' inside strings kept");
assert(/qeFetchExport\(sql, ds, onProgress, isCancelled\) \{\s*sql = qeCleanForRun\(sql\)/.test(src),"wired into fetch");
assert(/function qeStreamFullExport[^\n]*\n\s*sql = qeCleanForRun\(sql\)/.test(src),"wired into export ALL");
console.log("qe-clean-sql: 7 checks passed");
