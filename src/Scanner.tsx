import { useEffect, useRef, useState } from 'react';
import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser';
import { Camera, ImagePlus, Link2, X, ArrowRight } from 'lucide-react';
import { errorText } from './engine';
export function Scanner({onClose,onAdd}:{onClose:()=>void;onAdd:(value:string)=>Promise<void>}) {
  const [camera,setCamera]=useState(false),[error,setError]=useState(''),[value,setValue]=useState(''),[busy,setBusy]=useState(false);
  const video=useRef<HTMLVideoElement>(null), controls=useRef<IScannerControls|null>(null), submitted=useRef(false);
  const submit=async(text:string)=>{if(submitted.current)return;submitted.current=true;setBusy(true);setError('');controls.current?.stop();setCamera(false);try{await onAdd(text);}catch(e){setError(errorText(e));submitted.current=false;}finally{setBusy(false);}};
  useEffect(()=>{
    if(!camera || !video.current)return;
    let cancelled=false;const reader=new BrowserQRCodeReader();
    reader.decodeFromConstraints({video:{facingMode:{ideal:'environment'}}},video.current,(result)=>{if(result&&!cancelled)void submit(result.getText());}).then(c=>{if(cancelled)c.stop();else controls.current=c;}).catch(e=>{setError(e?.name==='NotAllowedError'?'Нет доступа к камере. Разрешите доступ в Safari или выберите фото.':'Не удалось открыть камеру. Попробуйте фото или ссылку.');setCamera(false);});
    return()=>{cancelled=true;controls.current?.stop();};
  },[camera]);
  useEffect(()=>{const handler=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler);},[onClose]);
  async function photo(file:File) {
    setBusy(true);setError('');const url=URL.createObjectURL(file);
    try{const result=await new BrowserQRCodeReader().decodeFromImageUrl(url);await submit(result.getText());}
    catch{setError('QR не найден. Выберите чёткое фото талона целиком или крупный снимок QR.');}
    finally{URL.revokeObjectURL(url);setBusy(false);}
  }
  return <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="scan-title"><button className="icon-button close" onClick={onClose} aria-label="Закрыть"><X/></button><div className="eyebrow">НОВЫЙ ТАЛОН</div><h2 id="scan-title">Ваша очередь —<br/>под рукой.</h2><p className="muted">Отсканируйте QR на талоне Миграции.<br/>Номер и услугу мы найдём автоматически.</p>
    {camera?<div className="camera-view"><video ref={video} muted playsInline/><div className="scan-frame"/><button className="button secondary" onClick={()=>setCamera(false)}>Остановить камеру</button></div>:<button className="button primary full" disabled={busy} onClick={()=>{setError('');setCamera(true);}}><Camera size={20}/> Сканировать QR</button>}
    <label className={`button secondary full file-button ${busy?'disabled':''}`}><ImagePlus size={20}/> Выбрать фото талона<input aria-label="Фото QR-кода" type="file" accept="image/*" disabled={busy} onChange={e=>{const f=e.target.files?.[0];if(f)void photo(f);}}/></label>
    <div className="divider"><span>или вставьте ссылку</span></div>
    <form onSubmit={e=>{e.preventDefault();void submit(value);}}><label className="input-label" htmlFor="qr-input"><Link2 size={15}/> Ссылка или код из QR</label><input autoFocus id="qr-input" value={value} onChange={e=>setValue(e.target.value)} placeholder="https://mvr-migracia.sky.bg/…" autoCapitalize="none" autoCorrect="off" spellCheck={false}/><button className="button dark full" disabled={busy||!value.trim()}>{busy?'Добавляем…':'Отслеживать талон'}<ArrowRight size={18}/></button></form>
    {error&&<p role="alert" className="error-box">{error}</p>}<p className="privacy-note">Фото обрабатывается на устройстве и никуда не отправляется.</p>
  </section></div>;
}
