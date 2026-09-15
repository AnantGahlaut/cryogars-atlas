const fs=require('node:fs'),assert=require('node:assert/strict');
const text=fs.readFileSync(process.argv[2],'utf8');
for(const id of ['nxc-panel','nxc-open','nxc-core','nxc-tiff','nxc-export','nxc-export-module','nxc-mask','nxc-ui']){
  assert.equal((text.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id+' must be unique');
}
const modules=['nxc-core','nxc-tiff','nxc-export-module','nxc-mask','nxc-ui'];
for(let i=1;i<modules.length;i++){
  assert.ok(text.indexOf('id="'+modules[i-1]+'"')<text.indexOf('id="'+modules[i]+'"'),modules[i]+' must follow '+modules[i-1]);
}
for(const match of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(/type="application\/json"/.test(match[1]))JSON.parse(match[2]);else new Function(match[2]);
}
assert.equal((text.match(/\/\/ BEGIN SnowEx comparison bridge v1/g)||[]).length,1);
console.log('All inline scripts parse; comparison IDs and bridge are unique.');
