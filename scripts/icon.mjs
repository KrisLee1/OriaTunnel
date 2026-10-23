import fs from 'node:fs';import zlib from 'node:zlib';
const size=64,rows=[];
for(let y=0;y<size;y++){const row=Buffer.alloc(1+size*4);for(let x=0;x<size;x++){const i=1+x*4;const circle=(cx,cy,r)=>(x-cx)**2+(y-cy)**2<r*r;const ink=circle(17,32,8)||circle(46,17,7)||circle(46,47,7)||(x>17&&x<46&&(Math.abs(y-(32-(x-17)*15/29))<2||Math.abs(y-(32+(x-17)*15/29))<2));row.set(ink?[87,211,180,255]:[24,34,38,255],i)}rows.push(row)}
function crc(b){let c=0xffffffff;for(const v of b){c^=v;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0)}return(c^0xffffffff)>>>0}
function chunk(type,data){const t=Buffer.from(type),len=Buffer.alloc(4),sum=Buffer.alloc(4);len.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([t,data])));return Buffer.concat([len,t,data,sum])}
const h=Buffer.alloc(13);h.writeUInt32BE(size,0);h.writeUInt32BE(size,4);h[8]=8;h[9]=6;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',zlib.deflateSync(Buffer.concat(rows))),chunk('IEND',Buffer.alloc(0))]);
const ico=Buffer.alloc(22);ico.writeUInt16LE(1,2);ico.writeUInt16LE(1,4);ico[6]=size;ico[7]=size;ico.writeUInt16LE(1,10);ico.writeUInt16LE(32,12);ico.writeUInt32LE(png.length,14);ico.writeUInt32LE(22,18);
fs.mkdirSync('src-tauri/icons',{recursive:true});fs.writeFileSync('src-tauri/icons/icon.ico',Buffer.concat([ico,png]));fs.writeFileSync('src-tauri/icons/icon.png',png);
