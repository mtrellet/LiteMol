﻿/*
 * Copyright (c) 2016 - now David Sehnal, licensed under Apache 2.0, See LICENSE file for more info.
 */

namespace LiteMol.Bootstrap.Visualization {
    "use strict";
        
    import Visual = Entity.Visual.Any;
        
    export class DisplayList {
        private entries = new Map<number, Visual>(); 
        private originalThemes = new Map<number, LiteMol.Visualization.Theme>();        

        isEmpty() {
            return !this.entries.size;
        }
        
        add(v: Visual): boolean {
            if (this.entries.has(v.id) || !v.props.model) return false;

            this.entries.set(v.id, v);
            this.scene.scene.models.add(v.props.model, this.entries.size === 1);
                        
            let vis = v.state.visibility !== Entity.Visibility.None;
            if (v.props.model.getVisibility() !== vis) {
                v.props.model.updateVisibility(vis);
            }
            
            v.props.model.tag = v;
            return true;
        }

        remove(v: Visual) {
            if (!this.entries.has(v.id)) return false;
            
            this.entries.delete(v.id);
            this.originalThemes.delete(v.id); 
            this.scene.scene.models.removeAndDispose(v.props.model);
            v.props.model.tag = void 0;
            v.props.model = <any>void 0;
            return true;
        }
        
        get(id: number) {
            return this.entries.get(id);
        }
        
        resetThemesAndHighlight(sel?: Bootstrap.Tree.Selector<Bootstrap.Entity.Any>) {            
            if (!sel) {            
                this.originalThemes.forEach((t, id) => {
                    this.entries.get(id)!.props.model.applyTheme(t);
                });
                this.originalThemes.clear();
                this.entries.forEach(v => v.props.model.highlight(false));
                this.scene.scene.forceRender();
                return;
            }          
            
            let es = this.context.select(sel);
            for (let e of es) {
                if (!Entity.isVisual(e) || !this.originalThemes.has(e.id)) continue;
                let v = e as Visual;
                let t = this.originalThemes.get(v.id)!;
                v.props.model.applyTheme(t);
                v.props.model.highlight(false);       
                this.originalThemes.delete(v.id);         
            }    
            this.scene.scene.forceRender();
        }
        
        private highlightMoleculeModel(what: { model: Bootstrap.Entity.Molecule.Model, query: Core.Structure.Query.Source, isOn: boolean }) {
            let model = Utils.Molecule.findModel(what.model);
            if (!model) {
                console.warn('Highlight: Trying to highlight a non-molecule model entity, ignoring...');
                return;
            }
            
            let targets: Visual[] = [];
            this.context.select( Tree.Selection.byValue(what.model).subtree()).forEach(n => {
                if (Entity.isVisual(n) && this.entries.get(n.id)) targets.push(n);
            });
            
            if (!targets.length) return;
            
            let q = Utils.Molecule.getModelAndIndicesFromQuery(model, what.query);
            if (!q || !q.indices.length) return;
            
            let action = what.isOn ? LiteMol.Visualization.Selection.Action.Highlight : LiteMol.Visualization.Selection.Action.RemoveHighlight;
            for (let t of targets) {
                t.props.model.applySelection(q.indices, action);
            }
        }

        constructor(private context: Context, private scene: SceneWrapper) {            
            Event.Tree.NodeAdded.getStream(context).subscribe(e => {                
                if (!Entity.isClass(e.data, Entity.VisualClass)) return;
                this.add(e.data as Visual);
            });
            
            Event.Tree.NodeRemoved.getStream(context).subscribe(e => {                
                if (!Entity.isClass(e.data, Entity.VisualClass)) return;
                this.remove(e.data as Visual);
            }); 
                        
            Event.Tree.NodeUpdated.getStream(context).subscribe(e => {
                if (!Entity.isVisual(e.data)) return;                
                let m = this.entries.get(e.data.id);      
                if (!m) return;    
                let vis = m.state.visibility !== Entity.Visibility.None;
                if (m.props.model.getVisibility() !== vis) {
                    m.props.model.updateVisibility(vis);
                }
            }); 
            
            Command.Visual.UpdateBasicTheme.getStream(context).subscribe(e => {
                if (!this.entries.get(e.data.visual.id) || !Entity.isVisual(e.data.visual))  return;                
                let v = e.data.visual as Entity.Visual.Any;
                if (!this.originalThemes.get(v.id)) {
                    this.originalThemes.set(v.id, v.props.model.theme);
                }
                v.props.model.applyTheme(e.data.theme);                
            });
            
            Command.Molecule.Highlight.getStream(context).subscribe(e => this.highlightMoleculeModel(e.data));
            Command.Visual.ResetTheme.getStream(context).subscribe(e => this.resetThemesAndHighlight(e.data && e.data.selection));
        }
    }
    
    export class SceneWrapper {

        private _destroyed = false;
        private cameraChanged = new Rx.Subject<LiteMol.Visualization.Camera>();
        private cameraObserver = (c: LiteMol.Visualization.Camera) => this.cameraChanged.onNext(c);
        
        scene: LiteMol.Visualization.Scene;
        models: DisplayList;
        
        private resetScene() {
            if (this._destroyed) return;            
            Event.Visual.VisualSelectElement.dispatch(this.context, Interactivity.Info.empty);
            this.models.resetThemesAndHighlight();
            this.scene.camera.reset();            
        }
        
        get camera() {
            return this.scene.camera;
        }
                
        destroy() {
            if (this._destroyed) return;

            this.scene.camera.stopObserving(this.cameraObserver);
            this.scene.destroy();
            this.scene = <any>void 0;
            this._destroyed = true;
        }

        private handleEvent(e: any, event: Event.Type<Interactivity.Info>) {
            let data = <LiteMol.Visualization.Selection.Info>e.data;

            if (data && data.model && data.elements) {
                event.dispatch(this.context, Interactivity.Info.selection(data.model.tag, data.elements));
            } else {
                event.dispatch(this.context, Interactivity.Info.empty);
            }
        }
        
        private focusMoleculeModelSelection(sel: Entity.Molecule.Selection) {
            if (!Tree.Node.is(sel, Entity.Molecule.Selection)) {
                console.warn('Focus: Trying to focus on non-molecule selection, ignoring...');
                return;
            }            
            let model = Utils.Molecule.findModel(sel);
            if (!model) {
                console.warn('Focus: Molecule model for selection not found, ignoring...');
                return;
            }
            
            let center = { x: 0.1, y: 0.1, z: 0.1 };
            let r = Utils.Molecule.getCentroidAndRadius(model.props.model, sel.props.indices, center);
            this.scene.camera.focusOnPoint(center, r);           
        }
        
         private focusMoleculeModelOnQuery(what: { model: Bootstrap.Entity.Molecule.Model, query: Core.Structure.Query.Source }) {
            
            let q = Utils.Molecule.getModelAndIndicesFromQuery(what.model, what.query);
            if (!q || !q.indices.length) return;
            let center = { x: 0.1, y: 0.1, z: 0.1 };
            let r = Utils.Molecule.getCentroidAndRadius(q.model.props.model, q.indices, center);
            this.scene.camera.focusOnPoint(center, r);           
        }
        
        constructor(element: HTMLElement, private context: Context, options?: LiteMol.Visualization.SceneOptions) {
            this.models = new DisplayList(context, this);
            
            this.scene = new LiteMol.Visualization.Scene(element, options);
            this.scene.camera.observe(this.cameraObserver);
            this.scene.events.addEventListener('hover', e => this.handleEvent(e, Event.Visual.VisualHoverElement));
            this.scene.events.addEventListener('select', e => this.handleEvent(e, Event.Visual.VisualSelectElement)); 
            
            this.cameraChanged.throttle(1000 / 30).subscribe(c => {
                Event.Visual.CameraChanged.dispatch(this.context, c);
            });            
            
            Command.Entity.Focus.getStream(context)
                .subscribe(e => { 
                    if (e.data.length === 1) {
                        let t = e.data[0];
                        if (Entity.isMoleculeSelection(t)) {
                            this.focusMoleculeModelSelection(t as Entity.Molecule.Selection);
                        } else if (Entity.isClass(t, Entity.VisualClass)) {
                            this.scene.camera.focusOnModel((t as Visual).props.model);
                        }
                    } else {                                                
                        this.scene.camera.focusOnModel(...e.data.filter(e => Entity.isClass(e, Entity.VisualClass)).map(e => (e as Visual).props.model));
                    }
                });  
                
            Command.Entity.Highlight.getStream(context)
                .subscribe(e => { 
                    for (let v of e.data.entities) {
                        if (!Entity.isClass(v, Entity.VisualClass) || !(v as Visual).props.model) continue;
                        (v as Visual).props.model.highlight(e.data.isOn);
                    }
                });
                
            Command.Visual.ResetScene.getStream(context).subscribe(e => this.resetScene());
            Command.Molecule.FocusQuery.getStream(context).subscribe(e => this.focusMoleculeModelOnQuery(e.data));
        }

    }
}