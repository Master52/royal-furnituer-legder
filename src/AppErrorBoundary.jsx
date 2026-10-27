import {BRAND_LOGO} from './brand.js';
import React from 'react';
import {loadChallanRecovery,readEndpoint} from './storage.js';
import { downloadText } from './preferences.js';

export default class AppErrorBoundary extends React.Component {
  state = { error: null, exportError: '' };
  static getDerivedStateFromError(error) { return {error}; }
  exportRecoveryData = async () => {
    try {
      const backup = Object.fromEntries(['rf.outbox','rf.pending','rf.accounts.pending'].map(key => [key,localStorage.getItem(key)]));
      for(let index=0;index<localStorage.length;index++){const key=localStorage.key(index);if(key?.startsWith('rf.stock-pending:'))backup[key]=localStorage.getItem(key);}
      const endpoint=readEndpoint();if(endpoint){try{backup.challanUploads=await loadChallanRecovery(endpoint);}catch(error){backup.challanUploadError=error.message;}}
      downloadText(JSON.stringify(backup,null,2),'royal-ledger-recovery.json','application/json');
      this.setState({exportError:backup.challanUploadError?'Payment and stock recovery downloaded. Challan photos could not be read; keep this browser open.':''});
    } catch { this.setState({exportError:'Browser storage cannot be read. Keep this browser open and check its storage permissions.'}); }
  };
  render() {
    if (!this.state.error) return this.props.children;
    return <section className="app-recovery" role="alert"><img className="document-brand-logo" src={BRAND_LOGO} alt="Royal Furnitures"/><h1>The app could not open</h1><p>{this.state.error.message}</p><p>Your saved records have not been deleted.</p><button className="primary" onClick={this.exportRecoveryData}>Export recovery data</button> <button className="outline" onClick={() => window.location.reload()}>Reload</button>{this.state.exportError && <p>{this.state.exportError}</p>}</section>;
  }
}
