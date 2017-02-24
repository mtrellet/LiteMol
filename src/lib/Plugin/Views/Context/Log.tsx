﻿/*
 * Copyright (c) 2016 - now David Sehnal, licensed under Apache 2.0, See LICENSE file for more info.
 */

namespace LiteMol.Plugin.Views.Context {
    "use strict";

    import EntryType = Bootstrap.Service.Logger.EntryType

    export class Log extends View<Bootstrap.Components.Context.Log, {}, {}> {

        componentWillMount() {
            super.componentWillMount();
            this.subscribe(Bootstrap.Event.Common.LayoutChanged.getStream(this.controller.context), () => this.scrollToBottom());
        }

        componentDidUpdate() { 
            this.scrollToBottom();
        }
        
        private scrollToBottom() {
            let log = this.refs['log'] as HTMLElement;      
            if (log) log.scrollTop = log.scrollHeight - log.clientHeight - 1;
        }

        render() {
            let entries = this.controller.latestState.entries;
            
            return <div className='lm-log-wrap'>
                <div className='lm-log' ref='log'>
                    <ul className='lm-list-unstyled'>
                        {entries.map((entry, i, arr) => {

                            let msg: any;
                            let e = entry!;
                            switch (e.type) {
                                case EntryType.Message:
                                    msg = <div className='lm-log-entry'>{e.message}</div>;
                                    break;
                                case EntryType.Error:
                                    msg = <div className='lm-log-entry'><span className='label label-danger'>Error</span> {e.message}</div>;
                                    break;
                                case EntryType.Warning:
                                    msg = <div className='lm-log-entry'><span className='label label-warning'>Warning</span> {e.message}</div>;
                                    break;
                                case EntryType.Info:
                                    msg = <div className='lm-log-entry'><span className='label label-info'>Info</span> {e.message}</div>;
                                    break;
                            }
                            
                            let t = Bootstrap.Utils.formatTime(e.timestamp);
                            return <li key={i}>
                                    <div className={'lm-log-entry-badge lm-log-entry-' + EntryType[e.type].toLowerCase()} />
                                    <div className='lm-log-timestamp'>{t}</div>
                                    <div className='lm-log-entry'>{e.message}</div>
                                </li>;
                        }) }
                    </ul>
                </div>
            </div>;
        }
    }
}