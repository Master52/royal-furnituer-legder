import React from 'react';
import { categories, methods, money, localNow } from './ledger.js';

export default function PaymentEntry({ editing, cancelEdit, form, update, chooseCategory, save, formRef, amountRef, busy, pending, endpoint, rows, refresh, openHistory }) {
  const today = localNow().slice(0,10);
  const recent = rows.filter(t=>t.transactionDate===today).sort((a,b)=>b.transactionTime.localeCompare(a.transactionTime));
  return <section className="pos-layout">
    <form ref={formRef} className="entry-card" onSubmit={save}>
      {editing && <div className="editing-banner"><span>Editing {editing.transactionDate} · {money(editing.amountMinor)}<small>Your original date is preserved unless you change it.</small></span><button type="button" disabled={busy || !!pending} onClick={cancelEdit}>Cancel edit</button></div>}
      <fieldset disabled={busy || !!pending} className="entry-fields">
        <div className="segmented direction-picker">{['in','out'].map(d=><button type="button" key={d} aria-pressed={form.direction===d} className={form.direction===d?'chosen':''} onClick={()=>update('direction',d)}>Payment {d} {d==='in'?'↙':'↗'} <kbd>Alt + {d==='in'?'I':'O'}</kbd></button>)}</div>
        <div className="field-caption" id="category-label">Transaction type</div><div className="entry-categories" role="group" aria-labelledby="category-label">{categories.map((c,i)=><button key={c} type="button" aria-pressed={form.category===c} className={form.category===c?'selected':''} onClick={()=>chooseCategory(c)}><strong>{c}</strong><small>{c==='Bhara'?'Transport & delivery':c==='Sale'?'Customer payments':c==='Purchase'?'Supplier payments':'Everyday costs'}</small><kbd>Alt + {i+1}</kbd></button>)}</div>
        <label className="entry-amount">Amount (₹)<input ref={amountRef} inputMode="decimal" required type="number" min="0.01" max="1000000000" step="0.01" placeholder="0.00" value={form.amount} onChange={e=>update('amount',e.target.value)}/></label>
        <div className="field-caption" id="method-label">Payment method</div><div className="method-picker" role="group" aria-labelledby="method-label">{methods.map(m=><button key={m} type="button" aria-pressed={form.method===m} className={form.method===m?'selected':''} onClick={()=>update('method',m)}>{m}</button>)}</div>
        {form.method==='Cheque' && <label>Cheque given date <span className="required">Required</span><input type="date" required value={form.chequeDate} onChange={e=>update('chequeDate',e.target.value)}/></label>}
        <div className="entry-date"><span>{form.customDate ? 'Custom transaction date' : 'Today · time recorded when you save'}</span><button type="button" onClick={()=>update('customDate',!form.customDate)}>{form.customDate?'Use today':'Change date'}</button></div>
        {form.customDate && <label>Transaction date & time<input type="datetime-local" required value={form.dateTime} onChange={e=>update('dateTime',e.target.value)}/></label>}
        <label>Customer / vendor <span>Optional</span><input maxLength="150" autoComplete="off" value={form.party} onChange={e=>update('party',e.target.value)} placeholder="Name of person or business"/></label>
        <label>Notes <span>Optional</span><textarea maxLength="1000" rows="2" value={form.notes} onChange={e=>update('notes',e.target.value)} placeholder="What was this payment for?"/></label>
      </fieldset>
      <div className="entry-save"><button className="primary full" disabled={busy || !!pending || !endpoint}>{busy?'Please wait…':pending?'Retry pending payment above':!endpoint?'Connect Sheets to save':editing?'Save changes':'Save payment'} <kbd>Ctrl + Enter</kbd></button><p>{editing?'Updates this payment without creating a duplicate.':'Keep category & payment method for the next entry.'}</p></div>
    </form>
    <aside className="recent-panel"><div className="recent-heading"><div><p className="eyebrow">AT THE COUNTER</p><h2>Today’s payments</h2></div><button aria-label="Refresh recent payments" disabled={busy || !endpoint} onClick={()=>refresh()}>↻</button></div><p className="help">{today} · {recent.length} recorded</p>
      {recent.length ? <ul className="recent-list">{recent.slice(0,8).map(t=><li key={t.id}><div><strong>{t.party || t.category}</strong><small>{t.transactionTime} · {t.category} · {t.method}</small></div><b className={t.direction}>{t.direction==='in'?'+':'−'}{money(t.amountMinor)}</b></li>)}</ul> : <div className="recent-empty">Payments dated today will appear here after saving. Backdated payments are available in History.</div>}
      <button className="outline full" onClick={openHistory}>View transaction history →</button><details className="shortcut-help"><summary>Keyboard shortcuts</summary><p>Alt + N: new entry<br/>Alt + I / O: payment in / out<br/>Alt + 1–4: category<br/>Ctrl + Enter (⌘ + Enter on Mac): save<br/>Tab / Shift + Tab: move between fields<br/>Esc: close Settings</p><p>Shortcuts are paused while Settings is open. Some browser or operating system shortcuts may take precedence.</p></details>
    </aside>
  </section>;
}
