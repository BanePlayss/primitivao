// Prova que o EMULADOR aplica firestore.rules — o teste que faltava hoje,
// quando o archiveEpoch deu 403 so na producao.
const B='http://127.0.0.1:8080/v1/projects/primitivao/databases/(default)/documents';
const get=async p=>{const r=await fetch(`${B}/${p}`);return {st:r.status,j:r.ok?await r.json():null};};
const patch=async(p,fields,qs='')=>{const r=await fetch(`${B}/${p}?${qs}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({fields})});return r.status;};

const cur=(await get('primitivao/apostas')).j;
const json=cur.fields.json.stringValue;
const st=JSON.parse(json);
let ok=0,fail=0;
const t=(nome,cond,extra='')=>{ if(cond){ok++;console.log('  ok   '+nome);} else {fail++;console.log('  FALHA '+nome+' '+extra);} };

console.log('=== a rules esta ativa no emulador? ===');
// 1) escrita normal (json do mesmo tamanho) deve PASSAR
let s=await patch('primitivao/apostas',{json:{stringValue:json},updatedAt:{integerValue:String(Date.now())}},'updateMask.fieldPaths=json&updateMask.fieldPaths=updatedAt');
t('escrita normal passa', s===200, '(HTTP '+s+')');

// 2) encolher o json abaixo de 40% SEM archiveEpoch deve ser BLOQUEADO
const mini=JSON.stringify({...st,bets:[]});
s=await patch('primitivao/apostas',{json:{stringValue:mini}},'updateMask.fieldPaths=json');
t('notWipingJson barra encolhimento sem archiveEpoch', s===403, '(HTTP '+s+', esperado 403)');

// 3) o MESMO encolhimento COM archiveEpoch deve PASSAR (o fix de hoje)
s=await patch('primitivao/apostas',{json:{stringValue:mini},archiveEpoch:{integerValue:String(Date.now())}},'updateMask.fieldPaths=json&updateMask.fieldPaths=archiveEpoch');
t('archiveEpoch libera o arquivamento', s===200, '(HTTP '+s+', esperado 200)');

// 4) json gigante deve bater no payloadFits
s=await patch('primitivao/apostas',{json:{stringValue:'x'.repeat(960000)}},'updateMask.fieldPaths=json');
t('payloadFits barra json acima do teto', s===403, '(HTTP '+s+', esperado 403)');

// 5) colecao nao declarada deve ser negada pelo catch-all
s=await patch('coisa_aleatoria/abc',{a:{stringValue:'b'}});
t('catch-all nega colecao desconhecida', s===403, '(HTTP '+s+', esperado 403)');

console.log('\n'+(fail===0?'RULES ATIVA E CORRETA — '+ok+'/'+ok:fail+' falhas de '+(ok+fail)));
