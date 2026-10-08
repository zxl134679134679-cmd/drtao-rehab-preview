import {mapFormCommand} from './form-commands.js';
class LegacyImportError extends Error {
  constructor(code,message){super(message);this.name='LegacyImportError';this.code=code;}
}
export const LEGACY_HEADERS=Object.freeze(['客户姓名','手机号','所属门店','负责康复师','套餐名称','套餐金额（元）','套餐总次数','剩余次数','原档案编号／核对说明']);
const frozen=value=>value&&typeof value==='object'?Object.freeze(Array.isArray(value)?value.map(frozen):Object.fromEntries(Object.entries(value).map(([key,item])=>[key,frozen(item)]))):value;
const fileError=message=>{throw new LegacyImportError('IMPORT_FILE',message);};
function parseCSV(text) {
  if(typeof text!=='string'||text.includes('\uFFFD')||new TextEncoder().encode(text).byteLength>512*1024)fileError('请使用不超过512KB的CSV UTF-8文件');
  text=text.replace(/^\uFEFF/,'');let value='',cells=[],rows=[],quoted=false,closed=false;
  const cell=()=>{cells.push(value);value='';closed=false;};
  const row=()=>{cell();rows.push(cells);cells=[];if(rows.length>2000)fileError('空白行过多，请整理为每批最多50名客户');};
  for(let i=0;i<text.length;i++) {
    const char=text[i];
    if(quoted) {
      if(char==='"'){if(text[i+1]==='"'){value+='"';i++;}else{quoted=false;closed=true;}}
      else value+=char;
    } else if(char===',')cell();
    else if(char==='\r'||char==='\n'){if(char==='\r'&&text[i+1]==='\n')i++;row();}
    else if(closed)fileError('CSV引号后有多余内容，请重新另存CSV UTF-8');
    else if(char==='"'){if(value)fileError('CSV引号格式不正确，请重新另存CSV UTF-8');quoted=true;}
    else value+=char;
  }
  if(quoted)fileError('CSV引号未闭合，请重新另存CSV UTF-8');
  if(value||cells.length||closed)row();return rows;
}
function matching(rows,name,activeOnly=false) {
  const matches=rows.filter(row=>row.name?.trim()===name&&(!activeOnly||row.active===true));
  return matches.length===1?matches[0].id:null;
}

/** Pure preview. No file upload, mutation, import, guessed values or merge. */
export function previewLegacyCSV(text,{role,revision,clients,stores,therapists}={}) {
  if(role?.type!=='boss')throw new LegacyImportError('FORBIDDEN','历史客户批量导入由老板核对确认');
  if(!Number.isSafeInteger(revision)||revision<0||[clients,stores,therapists].some(rows=>!Array.isArray(rows)))throw new LegacyImportError('DATA_UNAVAILABLE','请先取得完整客户、门店和康复师资料');
  const parsed=parseCSV(text);
  if(!parsed.length)fileError('文件为空，请使用历史客户模板');
  const headers=parsed[0].map(value=>value.trim());
  if(new Set(headers).size!==headers.length||LEGACY_HEADERS.some(header=>!headers.includes(header))||headers.some(header=>!LEGACY_HEADERS.includes(header)&&header!=='填写提示'))fileError('表头与模板不一致，请保留9个资料列，可保留填写提示列');
  const indexes=LEGACY_HEADERS.map(header=>headers.indexOf(header));
  // Validate every physical data row before excluding blank/hint-only rows.
  // Otherwise a shifted row with data only beyond the header disappears.
  if(parsed.slice(1).some(cells=>cells.slice(headers.length).some(value=>value.trim())))fileError('数据列数与表头不一致，请检查未加引号的逗号');
  const source=parsed.slice(1).map((cells,index)=>({cells,rowNumber:index+2})).filter(({cells})=>indexes.some(index=>String(cells[index]||'').trim()));
  if(source.length<1||source.length>50)fileError('每批需要1至50名非空客户，请拆分文件');
  const phones=new Map(),existing=new Set(clients.map(client=>client.phone?.replace(/\s+/gu,'')));
  for(const record of source) {
    record.values=indexes.map(index=>String(record.cells[index]??'').trim());
    record.phone=record.values[1].normalize('NFKC').replace(/\s+/gu,'');
    if(record.phone)phones.set(record.phone,(phones.get(record.phone)||0)+1);
  }
  const rows=[],issues=[];
  for(const record of source) {
    const {values,rowNumber,phone}=record;let invalid=false;
    const issue=(field,message)=>{invalid=true;issues.push({rowNumber,field,message});};
    values.forEach((value,index)=>{if(!value)issue(LEGACY_HEADERS[index],'请补齐原档案资料；未知金额或次数请留待核对');});
    if(phone&&phones.get(phone)>1)issue('手机号','表内手机号重复或家庭共用，请人工核对，不能自动合并');
    if(phone&&existing.has(phone))issue('手机号','系统已有该手机号，请核对原客户档案，不能重复迁入');
    const storeId=matching(stores,values[2]),ownerId=matching(therapists,values[3],true);
    if(values[2]&&!storeId)issue('所属门店','门店未设置或存在同名门店，请先核对');
    if(values[3]&&!ownerId)issue('负责康复师','人员未设置、已停用或同名，请先核对选定负责人');
    if(invalid)continue;
    try {
      const mapped=mapFormCommand('import-opening',[['name',values[0]],['phone',phone],['storeId',storeId],['ownerId',ownerId],['packageName',values[4]],['amount',values[5]],['total',values[6]],['remaining',values[7]],['notes',values[8]]]);
      if(Math.round(mapped.payload.amount*100)<mapped.payload.total)issue('套餐金额（元）','套餐金额不能少于总次数对应的分金额');
      else rows.push(mapped.payload);
    } catch(error) {
      if(error.code!=='INVALID_FORM')throw error;
      issue('资料',error.message.replace(/\b(total|remaining|name|notes|packageName)\b/g,word=>({total:'套餐总次数',remaining:'剩余次数',name:'客户姓名',notes:'核对说明',packageName:'套餐名称'}[word])));
    }
  }
  return frozen({kind:'legacy-import-preview',revision,sourceRowCount:source.length,validCount:rows.length,canImport:issues.length===0&&rows.length===source.length,rows,issues});
}
