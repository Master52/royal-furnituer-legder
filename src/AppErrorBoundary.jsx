import React from 'react';
import { downloadText } from './preferences.js';

export default class AppErrorBoundary extends React.Component {
  state = { error: null, exportError: '' };
  static getDerivedStateFromError(error) { return {error}; }
  exportRecoveryData = () => {
    try {
      const backup = Object.fromEntries(['rf.outbox','rf.pending','rf.accounts.pending'].map(key => [key,localStorage.getItem(key)]));
      downloadText(JSON.stringify(backup,null,2),'royal-ledger-recovery.json','application/json');
    } catch { this.setState({exportError:'Browser storage cannot be read. Keep this browser open and check its storage permissions.'}); }
  };
  render() {
    if (!this.state.error) return this.props.children;
    return <section className="app-recovery" role="alert"><h1>The app could not open</h1><p>{this.state.error.message}</p><p>Your saved records have not been deleted.</p><button className="primary" onClick={this.exportRecoveryData}>Export recovery data</button> <button className="outline" onClick={() => window.location.reload()}>Reload</button>{this.state.exportError && <p>{this.state.exportError}</p>}</section>;
  }
}
