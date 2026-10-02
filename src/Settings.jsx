import React, { useEffect, useState } from 'react';
import { BACKEND_SOURCE, BUNDLED_BACKEND_VERSION } from './backend.js';
import PreferencesPanel from './PreferencesPanel.jsx';
import {versionAtLeast} from './version.js';
import {downloadText} from './preferences.js';
import {request, validateEndpoint, readAccessToken, accessTokenKey, ACCESS_CHANGED_EVENT} from './api.js';

export default function Settings({ endpoint, info, synced, url, setUrl, connect, disconnect, busy, pending, preferences, savePreferences, range, exportCsv, deleted, loadDeleted, restore, feedback, openTweak }) {
  const [copyStatus, setCopyStatus] = useState('');
  const [accessToken,setAccessToken]=useState(()=>endpoint?readAccessToken(endpoint):'');
  const [accessError,setAccessError]=useState('');
  const [accessNotice,setAccessNotice]=useState('');
  const [accessBusy,setAccessBusy]=useState(false);
  const [tab,setTab] = useState(endpoint ? 'preferences' : 'connection');
  useEffect(()=>{
    if(tab!=='tweaks')return;
    const handler=event=>{
      if(!event.altKey||!event.shiftKey||event.ctrlKey||event.metaKey||event.repeat)return;
      const key=event.key.toLowerCase();
      const type=key==='x'?'transfer':key==='a'?'adjustment':'';
      if(!type)return;
      event.preventDefault();openTweak(type);
    };
    window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler);
  },[tab,openTweak]);
  function download() {downloadText(BACKEND_SOURCE,'Code.gs');}
  async function saveAccess(event) {
    event.preventDefault();setAccessError('');setAccessNotice('');setAccessBusy(true);
    try {
      const destination=validateEndpoint((url||endpoint).trim()),token=accessToken.trim();
      if(token.length<32||token.length>128)throw new Error('Enter the access token from Apps Script → Project Settings → Script Properties.');
      const result=await request(destination,undefined,'list',{accessToken:token});
      sessionStorage.setItem(accessTokenKey(destination),token);
      window.dispatchEvent(new CustomEvent(ACCESS_CHANGED_EVENT,{detail:{endpoint:destination}}));
      setAccessNotice(versionAtLeast(result.backendVersion,'1.17.0')?'Access verified for this browser session.':'Token saved. Update Code.gs to 1.17.0 or newer to protect this deployment; older scripts do not verify tokens.');
    }catch(error){setAccessError(error.message);}finally{setAccessBusy(false);}
  }
  async function copy() {
    try { await navigator.clipboard.writeText(BACKEND_SOURCE); setCopyStatus('Code copied. Paste it into the Apps Script editor.'); }
    catch { setCopyStatus('Copy is unavailable in this browser. Download Code.gs or select the code below.'); }
  }
  return <div className="connection-settings">
    <div className="settings-tabs" role="group" aria-label="Settings sections"><button type="button" aria-pressed={tab==='preferences'} onClick={()=>setTab('preferences')}>Shop & preferences</button><button type="button" aria-pressed={tab==='tweaks'} onClick={()=>setTab('tweaks')}>Tweaks</button><button type="button" aria-pressed={tab==='connection'} onClick={()=>setTab('connection')}>Google Sheets setup</button></div>
    {tab==='preferences' ? <PreferencesPanel key={endpoint} preferences={preferences} savePreferences={savePreferences} range={range} exportCsv={exportCsv} deleted={deleted} loadDeleted={loadDeleted} restore={restore} busy={busy} pending={pending} endpoint={endpoint} feedback={feedback}/> : <>
    {tab==='tweaks' ? <><p className="help">Optional tools for adjusting cash and online balances. They stay out of the regular payment entry screen.</p><section className="setup-step tweak-tools"><h3>Cash & online tools</h3><p>Use these when money is exchanged between payment methods or when the counted balance differs from the ledger.</p><button type="button" className="outline full" disabled={busy||!!pending||!endpoint} onClick={()=>openTweak('transfer')}>Record cash ↔ online exchange <kbd>Alt + Shift + X</kbd></button><button type="button" className="outline full" disabled={busy||!!pending||!endpoint} onClick={()=>openTweak('adjustment')}>Adjust cash or online balance <kbd>Alt + Shift + A</kbd></button>{!endpoint&&<p className="help">Connect Google Sheets before recording balance tools.</p>}</section></> : <>
    <p className="help">Use your own Google Sheet. Your connection is remembered on this browser; no shop link is included in the app.</p>
    <section className="connection-details"><h3>Current connection</h3>
      <dl><dt>Saved web app URL</dt><dd className="endpoint-value">{endpoint || 'No sheet connected yet'}</dd>
        <dt>Connection status</dt><dd>{!endpoint ? 'Not connected' : synced ? 'Connected' : 'Not verified this session'}</dd>
        <dt>Deployed Code.gs version</dt><dd>{endpoint ? info?.version || 'Unknown — older scripts do not report a version' : 'Not connected'}</dd>
        {endpoint && info?.checkedAt && <><dt>Last successful check</dt><dd>{new Date(info.checkedAt).toLocaleString()}</dd></>}
        <dt>Code.gs included with this app</dt><dd>{BUNDLED_BACKEND_VERSION}</dd></dl>
      {endpoint && !versionAtLeast(info?.version,BUNDLED_BACKEND_VERSION) && <p className="help">{info?.version ? 'Your deployed script is older than the included version.' : 'Update your script to enable version reporting.'} Follow “Update an existing script” below.</p>}
    </section>
    <section className="setup-step"><h3>1. Get the Google Sheets code</h3><p>Create your own Google Sheet, then open <strong>Extensions → Apps Script</strong>. Replace the sample code with the file below and save.</p>
      <div className="setup-actions"><button type="button" className="primary" onClick={download}>↓ Download Code.gs</button><button type="button" className="outline" onClick={copy}>Copy code</button></div>
      <p role="status" className="help">{copyStatus}</p><details><summary>View Code.gs · {BUNDLED_BACKEND_VERSION}</summary><textarea aria-label="Google Apps Script source code" readOnly rows="9" value={BACKEND_SOURCE} onFocus={e=>e.target.select()}/></details>
    </section>
    <section className="setup-step"><h3>2. Set up and deploy</h3><ol>
      <li>Set the Sheet’s timezone under <strong>File → Settings</strong> to match your shop.</li>
      <li>In Apps Script, select <strong>setup</strong> in the function dropdown and click <strong>Run</strong>. Review and grant the requested permissions. This creates Transactions and Report tabs.</li>
      <li>Open <strong>Project Settings → Script Properties</strong> and copy <strong>LEDGER_ACCESS_TOKEN</strong>. setup creates this secret automatically. Keep it private.</li>
      <li>Click <strong>Deploy → New deployment → Web app</strong>.</li>
      <li>Choose <strong>Execute as: Me</strong> and <strong>Who has access: Anyone</strong>, then click <strong>Deploy</strong>.</li>
      <li>Google generates a <strong>Web app URL</strong> ending in <strong>/exec</strong>. Copy that URL—not the spreadsheet URL or a /dev URL.</li>
    </ol></section>
    <form className="setup-step" onSubmit={saveAccess}><h3>Ledger access</h3><label>Access token<input type="password" autoComplete="off" required minLength={32} maxLength={128} value={accessToken} onChange={event=>setAccessToken(event.target.value)} disabled={accessBusy}/></label><button className="outline full" disabled={accessBusy||!(endpoint||url)} aria-busy={accessBusy}>{accessBusy?'Verifying access…':'Verify & save access token'}</button>{accessError&&<p className="error" role="alert">{accessError}</p>}{accessNotice&&<p className="notice" role="status">{accessNotice}</p>}<p className="help">Required for Code.gs 1.17.0 and newer. Saved for this browser session only. Verifying access also retries uploads waiting for authorization.</p></form>
    <form className="setup-step" onSubmit={connect}><h3>3. Connect your sheet</h3><label>Apps Script web app URL<input required type="url" value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" disabled={busy}/></label>
      <button className="primary full" disabled={busy || accessBusy || (!!pending && !!endpoint)} aria-busy={busy}>{busy ? 'Checking connection…' : 'Test & save connection'}</button>
      {pending && <p className="help">{endpoint ? 'Resolve your pending payment before changing or disconnecting the sheet.' : 'A pending payment remains on this device. Connect its original sheet before retrying.'}</p>}
      <p className="help">The URL is saved only after a successful connection. It stays here after closing the browser, but does not transfer to another device, browser, or website address. Clearing site data removes it.</p>
    </form>
    <details className="setup-step"><summary>Update an existing script</summary><p>Download the included Code.gs, replace the old code in Apps Script, save, and run setup. Existing transactions are preserved. Then select <strong>Deploy → Manage deployments → Edit → New version → Deploy</strong>. Keep the same deployment URL. Test the saved connection again to see its new version.</p></details>
    <details className="setup-step"><summary>Connection troubleshooting</summary><p>If you see “Failed to fetch” or a CORS error, open your /exec URL in an incognito window. It should show an authentication-required JSON response, not a Google sign-in page. Verify your access token above. Confirm access is Anyone and that you deployed the latest version. Some work accounts restrict public web apps.</p><p>For report-date errors, run resetReportDates in Apps Script. This resets the report period to this month.</p></details>
    <p className="help">Keep your Sheet private. Code.gs 1.17.0 requires your separate access token for every ledger request. Anyone with both the token and web app URL can access your records. Older deployments remain unprotected until updated. This is shared shop access, not individual user accounts.</p>
    {endpoint && <button type="button" className="outline full disconnect" disabled={busy || !!pending} onClick={disconnect}>Disconnect this browser</button>}
    </>}</>}
  </div>;
}
