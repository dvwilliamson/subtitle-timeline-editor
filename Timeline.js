/**
 * Timeline class
 * By: Joshua Monson
 * Date: October 2011
 *
 * The timeline class renders a Final Cut Pro-like timeline onto the browser window. It was designed with the purpose of creating and editing
 * subtitles but it can be used for other purposes too.
 **/
var Timeline = (function(){
	"use strict";
	var Proto,
		lastTime = 0,
		requestFrame = window.requestAnimationFrame || window.mozRequestAnimationFrame,
		cancelFrame = window.cancelAnimationFrame || window.mozCancelAnimationFrame;

    if(!requestFrame){
        requestFrame = function(callback) {
            var currTime = +(new Date),
                timeToCall = Math.max(0, 16 - (currTime - lastTime)),
                id = window.setTimeout(function() { callback(currTime + timeToCall); }, timeToCall);
            lastTime = currTime + timeToCall;
            return id;
        };
        cancelFrame = clearTimeout;
    }
	
	function Timeline(location, params) {
		if(!(location instanceof HTMLElement)){ throw new Error("Invalid DOM Insertion Point"); }
		if(!params){ params = {}; }
		var canvas = document.createElement('canvas'),
			overlay = document.createElement('canvas'),
			cache = document.createElement('canvas'),
			node = document.createElement('div'),
			fonts = params.fonts || new Timeline.Fonts({}),
			colors = params.colors || new Timeline.Colors({}),
			images = params.images || new Timeline.Images({}),
			cursors = params.cursors || new Timeline.Cursors({}),
			width = params.width || location.offsetWidth,
			length = params.length || 1800,
			abRepeatOn = false,
			that = this;

		Object.defineProperties(this,{
			fonts: {
				get: function(){ return fonts; },
				set: function(obj){ fonts = obj; this.render(); },
				enumerable:true
			},colors: {
				get: function(){ return colors; },
				set: function(obj){ colors = obj; this.render(); },
				enumerable:true
			},images: {
				get: function(){ return images; },
				set: function(obj){ images = obj; this.render(); },
				enumerable:true
			},cursors: {
				get: function(){ return cursors; },
				set: function(obj){ cursors = obj; this.render(); },
				enumerable:true
			},length: { // In seconds
				get: function(){ return length; },
				set: function(val){
					var vlen, vend;
					if(val != length){
						length = val;
						vend = this.view.endTime;
						vlen = vend - this.view.startTime;
						if(length < vend){
							this.view.endTime = length;
							this.view.startTime = Math.max(0,length-vlen);
						}
						this.render();
					}
					return length;
				},enumerable:true
			},width: { // In pixels
				get: function(){ return width; },
				set: function(val){
					var id;
					if(val != width){
						width = +val;
						canvas.width = width;
						overlay.width = width;
						cache.width = width;
						for(id in this.audio){
							this.audio[id].width = width;
						}
						// Re-render the timeline
						this.render();
					}
					return width;
				},enumerable: true
			},timeMarkerPos: {
				value: 0, writable: true
			},commandStack: {
				value: params.stack || new EditorWidgets.CommandStack()
			},
			abRepeatSet: {
				get: function(){ return !(this.repeatA === null || this.repeatB === null); }
			},
			abRepeatOn: {
				get: function(){ return abRepeatOn; },
				set: function(on){
					on = this.abRepeatSet && (!!on);
					if(abRepeatOn !== on){
						abRepeatOn = on;
						this.render();
						this.emit(on?'abRepeatEnabled':'abRepeatDisabled');
					}
					return on;
				}
			}
		});

		this.multi = !!params.multi;
		this.autoSelect = !!params.autoSelect;
		this.currentTool = (typeof params.tool === 'number')?params.tool:Timeline.SELECT;

		this.selectedSegments = [];
		this.toCopy = [];
		this.events = {};
		this.tracks = [];
		this.audio = {};
		this.trackIndices = {};

		this.activeElement = null;
		this.activeIndex = -1;
		this.sliderActive = false;
		this.scrubActive = false;

		this.slider = new Timeline.Slider(this);
		this.view = new Timeline.View(this, params.start || 0, params.end || 60);

		this.repeatA = null;
		this.repeatB = null;
		this.abRepeatSetting = false;

		// Sizing
		this.height = this.keyHeight + this.trackPadding + this.sliderHeight;
		
		//rendering control
		this.requestedTrack = null;
		this.requestedFrame = 0;

		//mouse control
		this.mouseDown = false;
		this.mouseDownPos = {x: 0, y: 0};
		this.mousePos = {x: 0, y: 0};
		this.scrollInterval = 0;
		this.currentCursor = "pointer";

		//context menu
		this.activeMenu = null;
		this.menuOptions = Timeline.Menu?[].slice.call(Timeline.Menu):[]; //just in case .Menu is overwritten

		// Canvas
		this.canvas = canvas;
		this.context = canvas.getContext('2d');
		canvas.width = width;
		canvas.height = this.height;
		canvas.addEventListener('mousemove', mouseMove.bind(this), false);
		canvas.addEventListener('mouseup', mouseUp.bind(this), false);
		canvas.addEventListener('mouseout', mouseOut.bind(this), false);
		canvas.addEventListener('mousedown', mouseDown.bind(this), false);
		canvas.addEventListener('mousewheel', mouseWheel.bind(this), false);
		canvas.addEventListener('DOMMouseScroll', mouseWheel.bind(this), false); //Firefox
		canvas.addEventListener('contextmenu', contextMenu.bind(this), false);
		document.addEventListener('click', function(){
			if(that.activeMenu){
				that.activeMenu.parentNode.removeChild(that.activeMenu);
				that.activeMenu = null;
			}
		},false);

		this.overlay = overlay;
		this.octx = overlay.getContext('2d');
		overlay.width = width;
		overlay.height = this.height;
		overlay.style.position = "absolute";
		overlay.style.top = 0;
		overlay.style.left = 0;
		overlay.style.pointerEvents = "none";

		//This canvas is never seen, but it must be attached to the DOM for LTR text to render properly.
		//No one knows why, it simply is so
		this.cache = cache;
		this.ctx = cache.getContext('2d');
		cache.width = width;
		cache.height = this.height;
		cache.style.display = 'none';

		node.style.position = "relative";
		node.appendChild(canvas);
		node.appendChild(overlay);
		node.appendChild(cache);

		node.addEventListener('drop', dragDrop.bind(this), false);
		node.addEventListener('dragover', dragOver.bind(this), false);

		location.appendChild(node);

		this.render();
	}

	Timeline.ORDER = 0;
	Timeline.SELECT = 1;
	Timeline.MOVE = 2;
	Timeline.CREATE = 3;
	Timeline.DELETE = 4;
	Timeline.REPEAT = 5;
	Timeline.SCROLL = 6;
	Timeline.SHIFT = 7;
	Timeline.SPLIT = 8;

	Proto = Timeline.prototype;

	Object.defineProperties(Proto,{
		trackNames: {get: function(){ return Object.keys(this.trackIndices); }, enumerable: true }
	});
	
	// Sizing
	Proto.trackHeight = 50;
	Proto.trackPadding = 10;
	Proto.sliderHeight = 25;
	Proto.sliderHandleWidth = 10;
	Proto.segmentTextPadding = 5;
	Proto.keyTop = 0;
	Proto.keyHeight = 25;

	/** Event Triggers **/

	Proto.emit = function(evt, data){
		var that = this, fns = this.events[evt];
		fns && fns.forEach(function(cb){ try{cb.call(that,data);}catch(e){} });
	};

	Proto.on = function(name, cb){
		if(this.events.hasOwnProperty(name)){ this.events[name].push(cb); }
		else{ this.events[name] = [cb]; }
	};

	/** Context menu functions*/

	function clickMenu(action,pos,vars){
		var tl = this.timeline;
		if(tl.activeMenu){
			tl.activeMenu.parentNode.removeChild(tl.activeMenu);
			tl.activeMenu = null;
		}
		action.call(this,pos,vars);
	}

	function checkMenuSize(){
		this.classList.remove('tl-menu-up');
		if(this.getBoundingClientRect().bottom > window.innerHeight){
			this.classList.add('tl-menu-up');
		}
	}

	function buildLevel(pos, opts, ovars, that){
		var menu = document.createElement('ul');
		opts.forEach(function(opt){
			var ul, li,
				nthat = this,
				vars = ovars;
			if(opt.vars){
				vars = Object.create(vars);
				Object.keys(opt.vars).forEach(function(key){
					vars[key] = opt.vars[key].call(nthat,pos,ovars);
				});
			}
			if(opt.condition && !opt.condition.call(this,pos,vars)){ return; }
			li = document.createElement('li');
			li.innerHTML = "<a>"+opt.label+"</a>";
			if(opt.submenu && (typeof opt.submenu.forEach === 'function')){
				ul = buildLevel(pos, opt.submenu, vars, this);
				li.appendChild(ul);
				li.addEventListener('mouseover',checkMenuSize.bind(ul),false);
			}
			opt.action &&
				li.addEventListener('click',clickMenu.bind(this,opt.action,pos,vars),false);
			menu.appendChild(li);
		},that);
		return menu;
	}

	Proto.showMenu = function(pos){
		var cvs = this.canvas,
			top = (pos.y + cvs.offsetTop),
			left = (pos.x + cvs.offsetLeft),
			track = this.trackFromPos(pos),
			menu = buildLevel(pos,this.menuOptions,{},{
				timeline: this,
				track: track,
				segment: track && track.segFromPos(pos)
			});

		if(left < cvs.offsetWidth/2){
			menu.className = "tl-context-menu";
			menu.style.left = left + 2 + "px";
		}else{
			menu.className = "tl-context-menu tl-menu-right";
			menu.style.right = (cvs.offsetWidth-left) + "px";
		}

		menu.style.top = top + "px";
		cvs.parentNode.appendChild(menu);
		if(menu.getBoundingClientRect().bottom > window.innerHeight){
			menu.style.top = 'auto';
			menu.style.bottom = (cvs.offsetHeight-top) + "px";
		}
		this.activeMenu = menu;
	};

	Proto.addMenuItem = function(path,action,condition,pos){
		var that = this, optname, idx, opt,
			sequence = path.split('.'),
			submenu = this.menuOptions;

		if(!sequence.length){ throw new Error("No Path"); }
		if(typeof action !== 'function'){ throw new Error("No Action Function"); }

		opt = {submenu:submenu};
		do{	if(!opt.hasOwnProperty('submenu')){ opt.submenu = []; }
			submenu = opt.submenu;
			optname = sequence.shift();
			for(idx = 0; (opt = submenu[idx]) && opt.label != optname; idx++){
				//console.log(optname,opt);
			}
			if(idx === submenu.length){
				opt = {label:optname};
				pos = Math.floor(+pos)||submenu.length;
				submenu.splice(pos,0,opt);
			}
		}while(sequence.length);

		opt.action = action;
		if(typeof condition === 'function'){
			opt.condition = condition;
		}
	};
	
	Proto.getMenuItems = function(path){
		var that = this, optname, idx, opt,
			sequence = path.split('.'),
			submenu = this.menuOptions;

		opt = {submenu:submenu};
		do{	if(!opt.hasOwnProperty('submenu')){ return []; }
			submenu = opt.submenu;
			optname = sequence.shift();
			for(idx = 0; (opt = submenu[idx]) && opt.label != optname; idx++){
				//console.log(optname,opt);
			}
			if(idx === submenu.length){ return []; }
		}while(sequence.length);
		return opt.submenu.slice();
	};

	/**
	 * Helper Functions
	 *
	 * These functions deal with manipulating the data
	 **/

	Proto.timeInView = function(time){
		return time < this.view.endTime && time > this.view.startTime;
	};

	Proto.spanInView = function(start, end){
		return start < this.view.endTime && end > this.view.startTime;
	};

	Proto.getTrackTop = function(track) {
		return this.keyHeight + this.trackPadding + (this.trackIndices[track.id] * (this.trackHeight + this.trackPadding));
	};

	Proto.getTrack = function(id){
		return this.trackIndices.hasOwnProperty(id)?this.tracks[this.trackIndices[id]]:null;
	};

	Proto.trackFromPos = function(pos) {
		return this.tracks[this.indexFromPos(pos)]||null;
	};

	Proto.segFromPos = function(pos) {
		var track = this.tracks[this.indexFromPos(pos)];
		if(!track){ return null; }
		return track.segFromPos(pos);
	};

	Proto.indexFromPos = function(pos){
		var i, bottom,
			padding = this.trackPadding,
			height = this.trackHeight,
			top = this.keyHeight + this.trackPadding;
		for(i = 0; i < this.tracks.length; i++, top = bottom + padding) {
			bottom = top + height;
			if(pos.y >= top && pos.y <= bottom)
				return i;
		}
		return -1;
	};

	function swaptracks(n,o){
		this.tracks[this.trackIndices[n.id]] = n;
		n.render();
		this.commandStack.removeEvents(o.id);
		this.emit("removetrack",o);
		this.emit("addtrack",n);
	}

	Proto.hasTextTrack = function(name){
		return this.trackIndices.hasOwnProperty(name);
	};
	
	Proto.addTextTrack = function(textTrack,mime,overwrite) {
		if(!overwrite && this.trackIndices.hasOwnProperty(textTrack.label)){ throw new Error("Track name already in use."); }
		var track = new Timeline.TextTrack(this, textTrack, mime);
		if(this.trackIndices.hasOwnProperty(textTrack.label)){
			swaptracks.call(this,track,this.tracks[this.trackIndices[track.id]]);
		}else{
			this.trackIndices[track.id] = this.tracks.length;
			this.tracks.push(track);
			// Adjust the height
			this.height += this.trackHeight + this.trackPadding;
			this.canvas.height = this.height;
			this.overlay.height = this.height;
			this.cache.height = this.height;
			this.render();
			this.emit("addtrack",track);
		}
	};

	Proto.removeTextTrack = function(id) {
		var i,t,track,aid,loc;
		if(this.trackIndices.hasOwnProperty(id)){
			loc = this.trackIndices[id];
			aid = this.tracks[loc].audioId;
			if(this.audio.hasOwnProperty(aid)){ this.audio[aid].references--; }
			track = this.tracks.splice(loc, 1)[0];
			delete this.trackIndices[id];

			for(i=loc;t=this.tracks[i];i++){
				this.trackIndices[t.id] = i;
			}

			// Adjust the height
			this.height -= this.trackHeight + this.trackPadding;
			this.canvas.height = this.height;
			this.overlay.height = this.height;
			this.cache.height = this.height;
			this.render();
			this.commandStack.removeEvents(track.id);
			this.emit("removetrack",track);
		}
	};

	Proto.cloneTimeCodes = function(tid, kind, lang, name, overwrite) {
		if(this.trackIndices.hasOwnProperty(name)){
			if(!overwrite){ throw new Error("Track name already in use."); }
		}
		var track = this.tracks[this.trackIndices[tid]];
		if(!track){ throw new Error("Track does not exist"); }
		track = track.cloneTimeCodes(kind, lang, name);
		if(this.trackIndices.hasOwnProperty(name)){
			swaptracks.call(this,track,this.tracks[this.trackIndices[name]]);
		}else{
			this.trackIndices[name] = this.tracks.length;
			this.tracks.push(track);
			// Adjust the height
			this.height += this.trackHeight + this.trackPadding;
			this.canvas.height = this.height;
			this.overlay.height = this.height;
			this.cache.height = this.height;
			this.render();
			this.emit("addtrack",track);
		}
	};

	Proto.alterTextTrack = function(tid, kind, lang, name, overwrite) {
		var track = this.tracks[this.trackIndices[tid]];
		if(!track){ throw new Error("Track does not exist"); }
		if(name != track.id){
			if(this.trackIndices.hasOwnProperty(name)){
				if(!overwrite){ throw new Error("Track name already in use."); }
				this.removeTextTrack(name);
			}
			this.trackIndices[name] = this.trackIndices[track.id];
			delete this.trackIndices[track.id];
		}
		//avoid side-effects of settint track properties directly
		track.textTrack.kind = kind;
		track.textTrack.language = lang;
		track.textTrack.label = name;
		this.render();
	};

	/** Audio Functions **/	
	
	Proto.addAudioTrack = function(wave, id) {
		var track;
		if(this.audio.hasOwnProperty(id)){ throw new Error("Track with that id already loaded."); }
		if(wave instanceof Timeline.AudioTrack){
			track = wave;
			id = wave.id;
		}else{
			track = new Timeline.AudioTrack(this, wave, id);
		}
		this.audio[id] = track;
		this.render();
	};

	Proto.loadAudioTrack = function(source, id) {
		var rate = 1001, bufsize = 10000,
			chansize, framesize, buffer, channels, resampler,
			reader = Reader[(source instanceof File?"fromFile":"fromURL")](source),
			wave = new WaveForm(
				this.width,
				this.trackHeight,
				1/*channels*/,rate
			);
		
		this.addAudioTrack(wave, id);
		console.log("Initializing Audio Decoder");
		console.time("audio "+id);
		
		reader.on('format', function(data) {
			console.log("Decoding Audio...");
			channels = data.channelsPerFrame;
			bufsize -= bufsize%channels;
			buffer = new Float32Array(bufsize);
			chansize = bufsize/channels;
			framesize = Math.ceil(bufsize*rate/(data.sampleRate*channels));
			resampler = new Resampler(data.sampleRate,rate,1);
			resampler.receive = function(data){
				wave.addFrame(data.outBuffer); //addFrame emits redraw
				getData();
			};
		});
		reader.on('ready', getData);
		reader.start();
		
		function getData(){
			var i, j, chan;
			if(reader.get(buffer) !== 'filled'){
				console.log("Finished Decoding");
				console.timeEnd("audio "+id);
			}else{
				//deinterlace; select only the first channel
				chan = new Float32Array(chansize);
				for(i=0,j=0;j<bufsize;i++,j+=channels){
					chan[i] = buffer[j];
				}
				resampler.run(chan,new Float32Array(framesize));
			}
		}
	}
	
	Proto.removeAudioTrack = function(id){
		var i, top, ctx, track;
		if(!this.audio.hasOwnProperty(id)){ return; }
		if(this.audio[id].references){
			top = this.keyHeight+this.trackPadding,
			ctx = this.octx;
			for(i=0;track=this.tracks[i];i++){
				if(track.active && track.audioId === id){
					ctx.clearRect(0, top, this.width, this.trackHeight);
				}
				top += this.trackHeight + this.trackPadding;
			}
		}
		delete this.audio[id];
	};

	Proto.setAudioTrack = function(tid, aid){
		var track;
		if(!this.trackIndices.hasOwnProperty(tid)){ return; }
		track = this.tracks[this.trackIndices[tid]];
		if(this.audio.hasOwnProperty(track.audioId)){ this.audio[track.audioId].references--; }
		track.audioId = aid;
		if(this.audio.hasOwnProperty(aid)){
			this.audio[aid].references++;
			this.audio[aid].render();
		}
	};

	Proto.unsetAudioTrack = function(tid){
		var track, audio;
		if(!this.trackIndices.hasOwnProperty(tid)){ return; }
		track = this.tracks[this.trackIndices[tid]];
		audio = this.audio[track.audioId];
		if(audio){
			track.audioId = null;
			audio.references--;
			this.octx.clearRect(0, this.getTrackTop(track), this.width, this.trackHeight);
		}
	};

	Proto.addSegment = function(tid, cue, select){
		if(!this.trackIndices.hasOwnProperty(tid)){ return; }
		this.tracks[this.trackIndices[tid]].add(cue, select);
	};

	/** Drawing functions **/

	function renderBackground(tl) {
		var ctx = tl.ctx,
			grd = ctx.createLinearGradient(0,0,0,tl.height);

		// Draw the backround color
		grd.addColorStop(0,tl.colors.bgTop);
		grd.addColorStop(0.5,tl.colors.bgMid);
		grd.addColorStop(1,tl.colors.bgBottom);
		ctx.save();
		ctx.fillStyle = grd;
		ctx.globalCompositeOperation = "source-over";
		ctx.fillRect(0, 0, tl.width, tl.height);
		ctx.restore();
	}

	function renderKey(tl) {
		var ctx = tl.ctx,
			view = tl.view,
			zoom = view.zoom,
			power, d=0,
			hours, mins, secs, pixels,
			start, end, position, offset, increment;

		ctx.save();
		ctx.font         = tl.fonts.keyFont;
		ctx.textBaseline = 'top';
		ctx.fillStyle    = tl.fonts.keyTextColor;
		ctx.strokeStyle    = tl.fonts.keyTextColor;

		// Find the smallest increment in powers of 2 that gives enough room for 1-second precision
		power = Math.ceil(Math.log(ctx.measureText(" 0:00:00").width*zoom)/0.6931471805599453);
		increment = Math.pow(2,power);
		pixels = increment/zoom;

		//if we're below 1-second precision, adjust the increment to provide extra room
		if(power < 0){
			d = power<-2?3:-power;
			if(pixels < ctx.measureText(" 0:00:0"+(0).toFixed(d)).width){
				increment*=2;
				pixels*=2;
				d--;
			}
		}

		start = view.startTime;
		start -= start%increment;
		end = view.endTime;
		offset = tl.canvas.dir === 'rtl' ? -2 : 2;

		for (position = view.timeToPixel(start); start < end; start += increment, position += pixels) {
			// Draw the tick
			ctx.beginPath();
			ctx.moveTo(position, tl.keyTop);
			ctx.lineTo(position, tl.keyTop + tl.keyHeight);
			ctx.stroke();

			// Now put the number on
			secs = start % 60;
			mins = Math.floor(start / 60);
			hours = Math.floor(mins / 60);
			mins %= 60;

			ctx.fillText(
				hours + (mins<10?":0":":") + mins + (secs<10?":0":":") + secs.toFixed(d), position + offset,
				tl.keyTop + 2
			);
		}
		ctx.restore();
	}

	function renderABRepeat(tl) {
		if(!tl.abRepeatSet) { return; }
		var left = tl.view.timeToPixel(tl.repeatA),
			right = tl.view.timeToPixel(tl.repeatB),
			ctx = tl.ctx;
		ctx.save();
		ctx.fillStyle = tl.colors[tl.abRepeatOn?'abRepeat':'abRepeatLight'];
		ctx.fillRect(left, 0, right-left, tl.height);
		ctx.restore();
	}

	function renderTimeMarker(tl, x) {
		var ctx = tl.context;
		ctx.save();
		ctx.fillStyle = tl.colors.timeMarker;
		ctx.fillRect(x, 0, 2, tl.height);
		ctx.restore();
	}

	function renderTrack(track) {
		var left, right, ctx,
			height = this.trackHeight,
			top = this.getTrackTop(track),
			x = this.view.timeToPixel(this.timeMarkerPos)-1;

		track.render();
		//redo the peice of the abRepeat that we drew over
		if(this.abRepeatSet){
			left = this.view.timeToPixel(this.repeatA);
			right = this.view.timeToPixel(this.repeatB);
			if(right >= 0 || left <= this.width){
				ctx = this.ctx;
				ctx.save();
				ctx.fillStyle = this.colors[this.abRepeatOn?'abRepeat':'abRepeatLight'];
				ctx.fillRect(left, top, right-left, height);
				ctx.restore();
			}
		}
		ctx = this.context;
		//This copy is expensive; need to make it faster!
		ctx.drawImage(this.cache,0,top,this.width,height,0,top,this.width,height);
		//redo the peice of the timeMarker that we drew over
		if(x >= 0 || x <= this.width){
			ctx.save();
			ctx.fillStyle = this.colors.timeMarker;
			ctx.fillRect(x, top, 2, height);
			ctx.restore();
		}
		this.requestedTrack = null;
		this.requestedFrame = 0;
	}
	
	function render(stable) {
		var aid, audio, x;
		if(this.images.complete){
			if(!stable){
				renderBackground(this);
				renderKey(this);
				this.tracks.forEach(function(track){ track.render(); });
				for(aid in this.audio){ this.audio[aid].render(); }
				renderABRepeat(this);
				this.context.drawImage(this.cache,0,0);
			}
			x = this.view.timeToPixel(this.timeMarkerPos)-1;
			if(x >= -1 && x < this.width){
				renderTimeMarker(this,x);
			}
			this.slider.render();
			this.requestedTrack = null;
			this.requestedFrame = 0;
		}else{
			this.requestedTrack = null;
			this.requestedFrame = requestFrame(render.bind(this,stable));
		}
	}
	
	Proto.renderTrack = function(track) {
		if(this.requestedFrame){
			if(this.requestedTrack === track){ return; }
			cancelFrame(this.requestedFrame);
			this.requestedTrack = null;
			this.requestedFrame = requestFrame(render.bind(this,true));
		}else{
			this.requestedTrack = track;
			this.requestedFrame = requestFrame(renderTrack.bind(this,track));
		}
	};
	
	Proto.render = function(stable) {
		if(this.requestedTrack !== null){
			cancelFrame(this.requestedFrame);
		}else if(this.requestedFrame === 0){
			this.requestedTrack = null;
			this.requestedFrame = requestFrame(render.bind(this,stable));
		}
	};

	Proto.restore = function(){
		var aid, audio, x;
		if(!this.images.complete){ return; }
		this.context.drawImage(this.cache,0,0);
		x = this.view.timeToPixel(this.timeMarkerPos)-1;
		if(x >= -1 && x < this.width){
			renderTimeMarker(this,x);
		}
		this.slider.render();
	};

	/** Time functions **/

	Object.defineProperties(Proto,{
		currentTime: {
			set: function(time){
				var x, stable = false;
				if(time == this.timeMarkerPos){ return time; }
				if(this.abRepeatOn && time > this.repeatB) {
					time = this.repeatA;
					this.emit('jump',this.repeatA);
				}

				//move the view
				if(time < this.view.startTime){
					this.view.center(time - this.view.length/4);
				}else if(time > this.view.endTime) {
					this.view.center(time + this.view.length/4);
				}else{
					stable = true;
					x = this.view.timeToPixel(this.timeMarkerPos)-1;
					if(x > -1 && x < this.width){ //erase old time marker
						this.context.drawImage(this.cache,x,0,2,this.height,x,0,2,this.height);
					}
				}

				this.timeMarkerPos = time;
				this.tracks.forEach(function(track){ track.textTrack.currentTime = time; });
				this.emit('timeupdate', time);
				this.render(stable);
				return time;
			},
			get: function(){return this.timeMarkerPos;},
			enumerable: true
		},
		timeCode: {
			get: function(){
				var time = this.timeMarkerPos,
					secs = time % 60,
					mins = Math.floor(time / 60),
					hours = Math.floor(mins / 60);
				mins %= 60;
				return hours + (mins<10?":0":":") + mins + (secs<10?":0":":") + secs.toFixed(3);
			},enumerable: true
		}
	});

	function updateABPoints(pos){
		this[pos.x < this.view.timeToPixel((this.repeatA + this.repeatB) / 2)?'repeatA':'repeatB'] = this.view.pixelToTime(pos.x);
		this.render();
	}

	function resetABPoints(pos){
		this.repeatB = this.repeatA = this.view.pixelToTime(pos.x);
		this.emit('abRepeatSet');
	}

	Proto.clearRepeat = function() {
		this.repeatA = null;
		this.repeatB = null;
		this.abRepeatSetting = false;
		//the setter takes care of re-rendering
		if(this.abRepeatOn){ this.abRepeatOn = false; }
		else{ this.render(); }
		this.emit('abRepeatUnset');
	};
	
	Proto.setRepeat = function(start,end) {
		this.repeatA = Math.min(start,end);
		this.repeatB = Math.max(start,end);
		this.abRepeatSetting = false;
		//the setter takes care of re-rendering
		if(!this.abRepeatOn){ this.abRepeatOn = true; }
		else{ this.render(); }
		this.emit('abRepeatSet');
	};

	/** Persistence functions **/

	Proto.exportTracks = function(id) {
		var that = this;
		return (function(){
			var track;
			if(typeof id === 'string'){ //save a single track
				track = that.getTrack(id);
				if(track === null){ throw new Error("Track "+id+" Does Not Exist."); }
				return [track];
			}else if(id instanceof Array){ //save multiple tracks
				return id.map(function(tid){
					track = that.getTrack(tid);
					if(track === null){ throw new Error("Track "+tid+" Does Not Exist"); }
					return track;
				});
			}else{ //save all tracks
				return that.tracks;
			}
		})().map(function(track){
			return {
				collection:"tracks",
				mime: track.mime,
				name: TimedText.addExt(track.mime,track.id),
				data: track.serialize()
			};
		});
	};

	Proto.loadTextTrack = function(url, kind, lang, name, overwrite){
		var that = this,
			params = {
				kind: kind,
				lang: lang,
				label: name,
				success: function(track, mime){ that.addTextTrack(track,mime,overwrite); },
				error: function(){ alert("There was an error loading the track."); }
			};
		params[(url instanceof File)?'file':'url'] = url;
		TextTrack.get(params);
	};

	/** Scroll Tool Functions **/

	function autoScroll(){
		var delta = this.mousePos.x/this.width-.5;
		if(delta){
			this.view.move(10*(delta)*this.view.zoom);
			this.render();
		}
	}

	function initScroll(){
		this.currentCursor = 'move';
		this.canvas.style.cursor = this.cursors.move;
		this.scrollInterval = setInterval(autoScroll.bind(this),1);
	}

	function autoSizeL(){
		var mx = this.mousePos.x,
			dx = mx - this.slider.startx;
		if(dx){
			this.view.startTime += dx*this.view.zoom/10;
			this.render();
		}
	}

	function autoSizeR(){
		var mx = this.mousePos.x,
			dx = mx - this.slider.endx;
		if(dx){
			this.view.endTime += dx*this.view.zoom/10;
			this.render();
		}
	}

	function initResize(){
		var diff = this.mouseDownPos.x - this.slider.middle;
		if(diff < 0){
			this.currentCursor = 'resizeL';
			this.canvas.style.cursor = this.cursors.resizeL;
			this.scrollInterval = setInterval(autoSizeL.bind(this),1);
		}else if(diff > 0){
			this.currentCursor = 'resizeR';
			this.canvas.style.cursor = this.cursors.resizeR;
			this.scrollInterval = setInterval(autoSizeR.bind(this),1);
		}
	}

	/**
	 * Event Listeners and Callbacks
	 *
	 * These listeners include mouseMove, mouseUp, and mouseDown.
	 * They check the mouse location and active elements and call their mouse listener function.
	 *
	 * Author: Joshua Monson
	 **/

	function updateCursor(pos) {
		if(typeof pos !== 'object')
			return;
		var i,j,track,seg,shape,
			cursor = 'pointer';

		// Check the slider
		i = this.slider.onHandle(pos);
		if(i === 1) {
			cursor = 'resizeR';
		}else if(i === -1) {
			cursor = 'resizeL';
		}else if(this.slider.containsPoint(pos)) {
			cursor = 'move';
		}else
		// Check the key
		if(pos.y < this.keyHeight+this.trackPadding) {
			cursor = 'skip';
		}else if(this.currentTool === Timeline.REPEAT){
			cursor = !(this.abRepeatOn || this.abRepeatSetting) || pos.x < this.view.timeToPixel((this.repeatA + this.repeatB) / 2)?'repeatA':'repeatB';
		}else if(this.currentTool === Timeline.SCROLL){
			cursor =	(this.mousePos.y < (this.height - this.sliderHeight - this.trackPadding))?'move':
						(this.mousePos.x < this.slider.middle)?'resizeL':'resizeR';
		}else if(track = this.trackFromPos(pos)){ // Are we on a track?
			cursor = 	(this.currentTool === Timeline.ORDER)?'order':
						(this.currentTool === Timeline.SHIFT)?'move':
						(this.currentTool === Timeline.SELECT)?'select':
						track.getCursor(pos);
		}
		if(this.currentCursor != cursor){
			this.currentCursor = cursor;
			this.canvas.style.cursor = this.cursors[cursor];
		}
	}

	function mouseMove(ev) {
		var i, delta, active, swap, ctx,
			pos = {x: ev.offsetX || ev.layerX, y: ev.offsetY || ev.layerY};

		this.mousePos = pos;

		if(this.scrollInterval){ return; }
		if(this.scrubActive){
			i = this.view.pixelToTime(pos.x);
			this.emit('jump',i);
			this.currentTime = i;
		}else if(this.currentTool == Timeline.REPEAT && this.abRepeatSetting){
			updateABPoints.call(this,pos);
			updateCursor.call(this,pos);
			this.render();
		}else if(this.currentTool == Timeline.ORDER
			&& this.activeIndex !== -1){
			i = this.indexFromPos(pos);
			if(i !== -1 && i !== this.activeIndex){
				swap = this.tracks[i];
				active = this.tracks[this.activeIndex];

				this.tracks[i] = active;
				this.tracks[this.activeIndex] = swap;

				this.trackIndices[swap.id] = this.activeIndex;
				this.trackIndices[active.id] = i;

				this.activeIndex = i;
				this.render(); //could gain efficiency by just copying image segments
			}
		}else if(this.sliderActive){
			this.slider.mouseMove(pos);
		}else if(this.activeElement){
			this.activeElement.mouseMove(pos);
		}else{
			updateCursor.call(this,pos);
		}

		ev.preventDefault();
	}

	function mouseUp(ev) {
		var startTime, endTime, track, segments,
			that = this;
		if(ev.button > 0 || !this.mouseDown){ return; }
		if(this.currentTool === Timeline.REPEAT){
			this.abRepeatSetting = false;
			this.abRepeatOn = (this.repeatA !== this.repeatB);
		}
		mouseInactive.call(this,{x: ev.offsetX || ev.layerX, y: ev.offsetY || ev.layerY});
		ev.preventDefault();
	}

	function mouseOut(ev){
		if(ev.button > 0 || !this.mouseDown){ return; }
		mouseInactive.call(this,{x: ev.offsetX || ev.layerX, y: ev.offsetY || ev.layerY});
		ev.preventDefault();
	}

	function mouseInactive(pos){
		var id;
		this.mouseDown = false;
		this.activeIndex = -1;
		if(this.scrubActive){
			this.scrubActive = false;
			updateCursor.call(this,pos);
		}else if(this.sliderActive) {
			this.slider.mouseUp(pos);
			this.sliderActive = false;
			for(id in this.audio){ this.audio[id].redraw(); }
		}else if(this.scrollInterval){
			clearInterval(this.scrollInterval);
			this.scrollInterval = 0;
			for(id in this.audio){ this.audio[id].redraw(); }
		}else if(this.activeElement !== null) {
			this.activeElement.mouseUp(pos);
			this.activeElement = null;
		}
	}

	function mouseDown(ev) {
		if(ev.button > 0){ return; }
		var pos = {x: ev.offsetX || ev.layerX, y: ev.offsetY || ev.layerY},
			track,i;

		document.activeElement.blur();
		if(this.activeMenu){
			this.activeMenu.parentNode.removeChild(this.activeMenu);
			this.activeMenu = null;
		}

		this.mouseDown = true;
		this.mouseDownPos = pos;
		this.mousePos = pos;

		if(pos.y > this.height - this.sliderHeight - this.trackPadding){ // Check the slider
			if(this.slider.containsPoint(pos)) {
				this.slider.mouseDown(pos);
				this.sliderActive = true;
			}else if(this.currentTool == Timeline.SCROLL){
				initResize.call(this);
			}else{
				this.slider.middle = pos.x;
				this.render();
				if(pos.y > this.height - this.sliderHeight){
					this.slider.mouseDown(pos);
					this.sliderActive = true;
					this.canvas.style.cursor = this.cursors.move;
				}
			}
		}else if(pos.y < this.keyHeight+this.trackPadding) { // Check the key
			this.scrubActive = true;
			i = this.view.pixelToTime(pos.x);
			this.emit('jump',i);
			this.currentTime = i;
		}else switch(this.currentTool){
			case Timeline.REPEAT:
				this.abRepeatSetting = true;
				(this.abRepeatSet?updateABPoints:resetABPoints).call(this,pos);
				break;
			case Timeline.SCROLL:
				initScroll.call(this);
				break;
			case Timeline.ORDER:
				this.activeIndex = this.indexFromPos(pos);
				break;
			case Timeline.SELECT:
				if(this.multi){
					this.activeElement = new Selection(this,pos);
					break;
				}
			default: // Check tracks
				track = this.trackFromPos(pos);
				this.activeElement = track;
				track && track.mouseDown(pos);
		}
		ev.preventDefault();
	}

	function mouseWheel(ev) {
		var i, that = this,
			pos = {x: ev.offsetX || ev.layerX, y: ev.offsetY || ev.layerY},
			delta =  ev.detail?(ev.detail>0?-1:1):(ev.wheelDelta>0?1:-1);

		if(this.activeMenu){
			this.activeMenu.parentNode.removeChild(this.activeMenu);
			this.activeMenu = null;
		}

		this.mousePos = pos;

		if(pos.y > this.height - this.sliderHeight - this.trackPadding){ // Check the slider
			this.slider.middle += delta;
		}else if(pos.y < this.keyHeight+this.trackPadding) { // Check the key
			i = Math.min(Math.max(this.currentTime + delta*this.view.zoom,0),this.length);
			if(i !== this.currentTime){
				this.emit('jump',i);
				this.currentTime = i;
			}
		}else{
			delta /= 10;
			this.view.startTime += delta*(this.view.pixelToTime(pos.x)-this.view.startTime);
			this.view.endTime += delta*(this.view.pixelToTime(pos.x)-this.view.endTime);
		}
		this.render();
		Object.keys(this.audio).forEach(function(key){ that.audio[key].redraw(); });
		ev.preventDefault();
		return false;
	}

	function dragDrop(ev) {
		ev.stopPropagation();
		ev.preventDefault();
		var that = this, links, name,
			track = this.trackFromPos({x: ev.offsetX || ev.layerX, y: ev.offsetY || ev.layerY}),
			files = ev.dataTransfer.files,
			types = ev.dataTransfer.types;
			
		if(files.length){ //Load Local Files
			[].forEach.call(files,function(file){
				if(file.type.substr(0,6) === 'audio/'){ //Load audio waveform
					name = file.name;
					that.loadAudioTrack(file,name);
					if(files.length === 1 && track){
						that.setAudioTrack(track.id,name);
					}
				}else{ //Load text track
					TextTrack.get({
						file: file, label: file.name,
						kind: 'subtitles', lang: 'zxx',
						success: function(track, mime){
							track.mode = 'showing';
							that.addTextTrack(track,mime,true);
                            that.emit("dropTrack", track);
						}
					});
				}
			});
		}else{ //Load from URLs
			if(types.indexOf('text/x-moz-url') !== -1){
				links = ev.dataTransfer.getData('text/x-moz-url').split('\n').filter(function(e,i){ return !(i%2); });
			}else if(types.indexOf('text/uri-list') !== -1){
				links = ev.dataTransfer.getData('text/uri-list').split('\n').filter(function(e){ return e[0]!=='#'; });
			}else if(types.indexOf('text/plain') !== -1){
				links = ev.dataTransfer.getData('text/plain').split('\n');
			}else{ return; }
			links.forEach(function(url){
			    var xhr = new XMLHttpRequest();
				xhr.onload = function(event) {
					if(/audio\//g.test(xhr.getResponseHeader("Content-Type"))){	//Load an audio waveform
						name = /([^\/]+)\/?$/g.exec(url)[1];
						that.loadAudioTrack(url,name);
						if(links.length === 1 && track){
							that.setAudioTrack(track.id,name);
						}
					}else{ //Load a text track
						TextTrack.get({
							url: url, label: /([^\/]+)\/?$/g.exec(url)[1],
							kind: 'subtitles', lang: 'zxx',
							success: function(track,mime){
								track.mode = 'showing';
								that.addTextTrack(track,mime,true);
                                that.emit("dropTrack", track);
							}
						});
					}
				};
				xhr.open("HEAD", url, true);
				xhr.send(null);
			});
		}		
	}

	function dragOver(ev) {
		ev.stopPropagation();
		ev.preventDefault();
		ev.dataTransfer.dropEffect = 'copy';
	}

	function contextMenu(ev) {
		if(this.activeMenu){
			this.activeMenu.parentNode.removeChild(this.activeMenu);
			this.activeMenu = null;
		}
		this.showMenu({x: ev.offsetX || ev.layerX, y: ev.offsetY || ev.layerY});
		ev.preventDefault();
	}
	
	function Selection(tl,pos){
		this.tl = tl;
		this.dragged = false;
		this.startPos = pos;
	}
	
	Selection.prototype.mouseMove = function(npos){
		var tl = this.tl,
			spos = this.startPos,
			ctx = tl.context;
			
		this.dragged = true;
		tl.restore();
		
		ctx.save();
		
		ctx.fillStyle = tl.colors.selectBox;
		ctx.strokeStyle = tl.colors.selectBorder;
		ctx.strokeWidth = 1;
		
		ctx.beginPath();
		ctx.rect(	Math.min(spos.x,npos.x),
					Math.min(spos.y,npos.y),
					Math.abs(spos.x-npos.x),
					Math.abs(spos.y-npos.y));
		ctx.fill();
		ctx.stroke();
		
		ctx.restore();
	};
	
	Selection.prototype.mouseUp = function(epos){
		var tl = this.tl,
			view = tl.view,
			spos = this.startPos;
		
		tl.restore();
		if(!this.dragged){
			(function(){
				var track = tl.trackFromPos(epos),
					seg = tl.segFromPos(epos);
				if(!track){ return; }
				if(seg){ seg.toggle(); }
				else{ track.clearSelection(); }
				tl.renderTrack(track);
			}());
		}else{
			(function(){
				var i, n,
					startTime = view.pixelToTime(Math.min(spos.x,epos.x)),
					endTime = view.pixelToTime(Math.max(spos.x,epos.x)),
					top = Math.min(spos.y,epos.y),
					bottom = Math.max(spos.y,epos.y),
					kheight = tl.keyHeight + tl.trackPadding,
					theight = tl.trackHeight + tl.trackPadding;
				
				i = Math.max(0,top-kheight);
				i = Math[i%theight < tl.trackHeight?'floor':'ceil'](i/theight);
				n = bottom >= (tl.height - tl.sliderHeight)
					?tl.tracks.length-1
					:Math.floor((bottom-kheight)/theight);
				tl.tracks.slice(i,n+1).forEach(function(track){
					track.visibleSegments.forEach(function(seg){
						if(seg.selected || seg.startTime >= endTime || seg.endTime <= startTime){
							return;
						}
						seg.selected = true;
						tl.selectedSegments.push(seg);
						tl.emit('select', seg);
					});
				});
				tl.render();
			}());
		}		
	};

	return Timeline;
}());