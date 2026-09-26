import React, { useState } from 'react';
import { categories, methods, money } from './ledger.js';

export default function PreferencesPanel({ preferences, savePreferences, range, exportCsv, deleted, loadDeleted, restore, busy, pending, endpoint, feedback }) {
  const [draft,setDraft]=useState(preferences);
  const [dates,setDates]=useState(range);
  const change=(key,value)=>setDraft(previous=>({...previous,[key]:value}));
  return <div className="preferences-panel">
    <p className="help">Preferences are saved for this connection in this browser. Other devices can have their own settings.</p>
    {feedback && <p className="notice" role="status">{feedback}</p>}
    <form onSubmit={event=>{event.preventDefault();savePreferences(draft);}}>
      <fieldset disabled={busy} className="entry-fields">
        <section className="setup-step"><h3>Shop details</h3>
          <label>Shop name<input required maxLength="100" value={draft.shopName} onChange={e=>change('shopName',e.target.value)}/></label>
          <label>Address<textarea rows="2" maxLength="300" value={draft.address} onChange={e=>change('address',e.target.value)}/></label>
          <label>Phone number<input type="tel" maxLength="50" value={draft.phone} onChange={e=>change('phone',e.target.value)}/></label>
        </section>
        <section className="setup-step"><h3>Entry defaults</h3><div className="form-grid">
          <label>Default category<select value={draft.defaultCategory} onChange={e=>change('defaultCategory',e.target.value)}>{categories.map(c=><option key={c}>{c}</option>)}</select></label>
          <label>Default payment method<select value={draft.defaultMethod} onChange={e=>change('defaultMethod',e.target.value)}>{methods.map(m=><option key={m}>{m}</option>)}</select></label>
        </div><p className="help">Applied when the app opens or you choose New entry. After saving a payment, your last selection stays ready for repeated entries. Current drafts and edits are preserved.</p></section>
        <section className="setup-step"><h3>Appearance</h3><label>Theme<select value={draft.theme} onChange={e=>change('theme',e.target.value)}><option value="light">Light</option><option value="dark">Dark</option></select></label><label className="check-setting"><input type="checkbox" checked={draft.largeText} onChange={e=>change('largeText',e.target.checked)}/> Larger text</label></section>
        <section className="setup-step"><h3>Print preferences</h3><label className="check-setting"><input type="checkbox" checked={draft.printNotes} onChange={e=>change('printNotes',e.target.checked)}/> Include transaction notes</label><label className="check-setting"><input type="checkbox" checked={draft.printContact} onChange={e=>change('printContact',e.target.checked)}/> Include shop address and phone number</label><p className="help">Applies to the app’s A4 reports. Shop name is always printed. The Google Sheet Report tab is unchanged.</p></section>
        <button className="primary full">Save preferences</button>
      </fieldset>
    </form>
    <section className="setup-step"><h3>Export CSV backup</h3><p className="help">Download all active transactions in this date range, freshly loaded from Sheets. Category, search and payment-method filters do not affect this export. Deleted records are excluded.</p>
      <form onSubmit={e=>{e.preventDefault();exportCsv(dates);}}><div className="form-grid"><label>Export start date<input required type="date" value={dates[0]} onChange={e=>setDates([e.target.value,dates[1]])}/></label><label>Export end date<input required type="date" min={dates[0]} value={dates[1]} onChange={e=>setDates([dates[0],e.target.value])}/></label></div><button className="outline full" disabled={busy || !endpoint}>Download CSV</button></form>
    </section>
    <section className="setup-step"><h3>Deleted transactions</h3><p className="help">Restore a deleted payment with its original ID and details. It will return to its original transaction date in History.</p><button className="outline full" disabled={busy || !endpoint} onClick={loadDeleted}>{busy?'Please wait…':'Load / refresh deleted transactions'}</button>
      {deleted !== null && (deleted.length ? <ul className="deleted-list">{deleted.map(t=><li key={t.id}><div><strong>{t.party || t.category} · {money(t.amountMinor)}</strong><small>{t.transactionDate} · Payment {t.direction} · {t.method}</small><small>Deleted: {String(t.deletedAt).replace('T',' ').slice(0,19)} UTC</small>{t.notes && <p>{t.notes}</p>}</div><button className="outline" disabled={busy || !!pending} onClick={()=>restore(t)}>Restore</button></li>)}</ul> : <p className="help">No deleted transactions.</p>)}
      {pending && <p className="help">Resolve the pending payment before restoring records.</p>}
    </section>
  </div>;
}
