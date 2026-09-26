export type Block={id:string;text:string;page:number;formulaCrop?:{x:number;y:number;w:number;h:number}};
export type PaperPage={number:number;label:string;blocks:Block[];scanned:boolean;sourcePages?:number[]};
export type Paper={title:string;pages:PaperPage[];url?:string;kind:'pdf'|'text'};
export type ModelResult={translations:{id:string;text:string}[];answer:string;citations:{id:string;quote:string}[];warnings:string[];glossary:{term:string;translation:string}[];transcript:string[]};
export function splitText(text:string):string[]{return text.split(/\n\s*\n/).flatMap(p=>{const result=[];let s=p.trim();while(s.length>2200){let cut=s.lastIndexOf('. ',2200);if(cut<600)cut=s.lastIndexOf('。',2200)+1;if(cut<600)cut=2000;result.push(s.slice(0,cut).trim());s=s.slice(cut).trim();}if(s)result.push(s);return result;}).filter(Boolean);}
export function fromText(text:string,title:string):Paper{const blocks=splitText(text);const pages:PaperPage[]=[];let batch:string[]=[];let size=0;function flush(){const n=pages.length+1;pages.push({number:n,label:`文本片段 ${n}`,scanned:false,blocks:batch.map((text,i)=>({id:`p${n}-b${i+1}`,page:n,text}))});batch=[];size=0;}for(const b of blocks){if(size+b.length>6000&&batch.length)flush();batch.push(b);size+=b.length;}if(batch.length)flush();return {title:title.trim()||'未命名论文',kind:'text',pages:groupBySections(pages)};}
export function groupBySections(pages:PaperPage[]):PaperPage[]{
 const sections:PaperPage[]=[];
 const heading=(text:string)=>{
  const line=text.trim().split('\n')[0].trim();
  if(line.length>115)return null;
  if(/^(abstract|introduction|background|related work|method(?:ology)?|experiments?|results?|discussion|conclusions?|references|appendix(?: [A-Z])?|acknowledg(?:e)?ments?|摘要|引言|绪论|相关工作|方法|实验|结果|讨论|结论|参考文献|附录|致谢)$/i.test(line))return line;
  if(/^(?:[1-9]\d?(?:\.[1-9]\d?){0,3}|[IVX]{1,5})[.、]?\s+[^\d].{2,100}$/i.test(line)&&!/[.!?。！？]$/.test(line))return line;
  return null;
 };
 let current:PaperPage={number:1,label:'标题与作者',blocks:[],scanned:false,sourcePages:[]};
 const flush=()=>{if(current.blocks.length||current.sourcePages?.length){current.number=sections.length+1;current.scanned=current.blocks.length===0;sections.push(current);}};
 for(const physical of pages){
  for(const block of physical.blocks){const title=heading(block.text);
   if(title&&current.blocks.length){flush();current={number:sections.length+1,label:title,blocks:[],scanned:false,sourcePages:[]};}
   else if(title&&current.blocks.length===0)current.label=title;
   if(!current.sourcePages?.includes(block.page))current.sourcePages?.push(block.page);
   current.blocks.push(block);
  }
  if(!current.sourcePages?.includes(physical.number))current.sourcePages?.push(physical.number);
 }
 flush();return sections;
}
type Item={str:string;transform:number[];width:number;height:number;hasEOL?:boolean};
export function extractBlocks(items:Item[],page:number,width:number,height=width*1.4):Block[]{
 // Preserve the PDF's own item order. Most scholarly PDFs encode column order already.
 const groups:{text:string;y:number;x:number;height:number;right:number;bottom:number;top:number}[]=[];let current:typeof groups[number]|null=null;let lastX=0,lastWidth=0;
 for(const item of items){if(!item.str.trim())continue;const x=item.transform[4],y=item.transform[5],h=Math.max(item.height||Math.abs(item.transform[3]),1);const same=current&&Math.abs(y-current.y)<Math.max(2,h*.3)&&x>=lastX-3&&x-(lastX+lastWidth)<Math.max(40,width*.08);
 if(same&&current){const gap=x-(lastX+lastWidth);current.text+=(gap>h*.12&&!current.text.endsWith(' ')?' ':'')+item.str;current.right=Math.max(current.right,x+item.width);current.bottom=Math.min(current.bottom,y);current.top=Math.max(current.top,y+h);}else{if(current)groups.push(current);current={text:item.str,y,x,height:h,right:x+item.width,bottom:y,top:y+h};}lastX=x;lastWidth=item.width;
 }
 if(current)groups.push(current);
 const paras:{text:string;rows:typeof groups}[]=[];let value='',rows:typeof groups=[],prev:typeof groups[number]|undefined;
 for(const row of groups){const gap=prev?prev.y-row.y:0;const boundary=!!prev&&(gap< -2||gap>Math.max(4,prev.height*1.45)||Math.abs(row.x-prev.x)>width*.25||row.height>prev.height*1.3||prev.height>row.height*1.3||value.length>1700);
 if(boundary&&value){paras.push({text:value,rows});value='';rows=[];}value+=(value?'\n':'')+row.text;rows.push(row);prev=row;
 }
 if(value)paras.push({text:value,rows});
 // Keep front matter and fragmented formula labels together without dropping text.
 const compact:typeof paras=[];let short='',shortRows:typeof groups=[];const flush=()=>{if(short){compact.push({text:short,rows:shortRows});short='';shortRows=[];}};
 for(const para of paras){const heading=/^(abstract|references|conclusion|摘要|引言|结论|\d+(\.\d+)*\s+[A-Z])(?:\b|\s)/i.test(para.text.trim())&&para.text.length<120;
 if(heading||para.text.length>150){flush();compact.push(para);}else{if(short.length+para.text.length>550)flush();short+=(short?'\n':'')+para.text;shortRows.push(...para.rows);}}
 flush();return compact.flatMap(({text,rows})=>splitText(text).map(part=>{
  const lines=part.split('\n').map(line=>line.trim()).filter(Boolean);
  const mathLines=lines.filter(line=>/[=√∑∫∂∇≤≥≈∞]|(?:softmax|log|exp|sin|cos)\s*\(/i.test(line));
  const fragmented=mathLines.length>0&&(lines.length>=3||/[√∑∫]/.test(part))&&lines.some(line=>line.length<=3);
  if(!fragmented||!rows.length)return {text:part,page};
  const left=Math.min(...rows.map(r=>r.x)),right=Math.max(...rows.map(r=>r.right));
  const bottom=Math.min(...rows.map(r=>r.bottom)),top=Math.max(...rows.map(r=>r.top));
  const pad=8;
  return {text:part,page,formulaCrop:{x:Math.max(0,(left-pad)/width),y:Math.max(0,(height-top-pad)/height),w:Math.min(1,(right-left+pad*2)/width),h:Math.min(1,(top-bottom+pad*2)/height)}};
 })).map((block,i)=>({...block,id:`p${page}-b${i+1}`}));
}
