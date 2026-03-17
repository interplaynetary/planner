<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { tune as tuneState } from '$lib/tune-state.svelte';

	// --- Reactive state ---
	let topic = $state('');
	let speaking = $state(false);
	let listening = $state(true);
	let textInput = $state('');
	let messages = $state<{ from: string; text: string; ts: number }[]>([]);
	let peers = $state<string[]>([]);
	let status = $state<'idle' | 'connecting' | 'live' | 'error'>('idle');
	let errorMsg = $state('');
	let msgLog = $state<HTMLDivElement | undefined>(undefined);

	// --- Non-reactive refs ---
	let room: any = null;
	let localStream: MediaStream | null = null;
	const peerAudios = new Map<string, HTMLAudioElement>();
	let sendChat: ((data: { text: string }) => void) | null = null;

	// --- Sync to shared state ---
	$effect(() => { tuneState.status = status; });
	$effect(() => { tuneState.liveTopic = topic; });
	$effect(() => { tuneState.peerCount = peers.length; });
	$effect(() => { tuneState.liveCopyLink = status === 'live' ? copyLink : null; });

	// --- Watch tuneRequest from AppBar ---
	let lastTuneRequest = 0;
	$effect(() => {
		const req = tuneState.tuneRequest;
		if (req > lastTuneRequest) {
			lastTuneRequest = req;
			tune(tuneState.inputTopic);
		}
	});

	// --- Helpers ---
	function slugify(name: string): string {
		return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
	}

	function playStream(peerId: string, stream: MediaStream) {
		let audio = peerAudios.get(peerId);
		if (!audio) {
			audio = new Audio();
			audio.autoplay = true;
			document.body.appendChild(audio);
			peerAudios.set(peerId, audio);
		}
		audio.srcObject = stream;
		audio.muted = !listening;
	}

	function stopPeerAudio(peerId: string) {
		const audio = peerAudios.get(peerId);
		if (audio) { audio.srcObject = null; audio.remove(); peerAudios.delete(peerId); }
	}

	function copyLink() {
		const url = `${window.location.origin}${base}?tune=${encodeURIComponent(slugify(topic))}`;
		navigator.clipboard.writeText(url).catch(() => prompt('Copy this link:', url));
	}

	// Sync mute state to all active audio elements
	$effect(() => {
		for (const audio of peerAudios.values()) audio.muted = !listening;
	});

	// Auto-scroll message log
	$effect(() => {
		if (messages.length && msgLog) msgLog.scrollTop = msgLog.scrollHeight;
	});

	// --- tune ---
	async function tune(name: string) {
		const slug = slugify(name);
		if (!slug) return;
		leave();
		topic = name;
		status = 'connecting';
		errorMsg = '';
		try {
			const { joinRoom } = await import('trystero/torrent');
			room = joinRoom({
				appId: 'planner-tune',
				relayUrls: ['wss://tracker.webtorrent.dev', 'wss://tracker.openwebtorrent.com']
			}, slug);

			const [sendMessage, getMessage] = room.makeAction('chat');
			sendChat = sendMessage;

			getMessage((data: { text: string }, peerId: string) => {
				messages = [...messages, { from: peerId.slice(-6), text: data.text, ts: Date.now() }];
			});

			room.onPeerJoin((peerId: string) => {
				peers = [...peers, peerId];
				if (localStream) room.addStream(localStream, peerId);
			});

			room.onPeerLeave((peerId: string) => {
				peers = peers.filter((p: string) => p !== peerId);
				stopPeerAudio(peerId);
			});

			room.onPeerStream((stream: MediaStream, peerId: string) => {
				playStream(peerId, stream);
			});

			status = 'live';
			tuneState.expanded = true;
		} catch (e: any) {
			status = 'error';
			errorMsg = e.message ?? 'Failed to join room';
		}
	}

	// --- Audio ---
	async function startSpeaking() {
		try {
			localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
			speaking = true;
			if (room) room.addStream(localStream);
		} catch (e: any) {
			errorMsg = e.message ?? 'Microphone denied';
		}
	}

	function stopSpeaking() {
		if (localStream && room) room.removeStream(localStream);
		localStream?.getTracks().forEach((t) => t.stop());
		localStream = null;
		speaking = false;
	}

	// --- Text ---
	function sendText() {
		const text = textInput.trim();
		if (!text || !sendChat) return;
		sendChat({ text });
		messages = [...messages, { from: 'me', text, ts: Date.now() }];
		textInput = '';
	}

	// --- Leave ---
	function leave() {
		stopSpeaking();
		for (const audio of peerAudios.values()) { audio.srcObject = null; audio.remove(); }
		peerAudios.clear();
		room?.leave();
		room = null;
		sendChat = null;
		topic = '';
		status = 'idle';
		peers = [];
		messages = [];
		speaking = false;
		errorMsg = '';
		tuneState.expanded = false;
	}

	onMount(() => {
		const tuneParam = new URLSearchParams(window.location.search).get('tune');
		if (tuneParam) {
			tuneState.inputTopic = tuneParam;
			tune(tuneParam);
		}
		return () => leave();
	});
</script>

{#if tuneState.expanded && status === 'live'}
	<!-- Expanded chat/audio panel — anchored below AppBar -->
	<div class="widget">
		<div class="live-bar">
			<span class="live-dot"></span>
			<span class="live-label">LIVE</span>
			<button class="topic-link" title="Copy share link" onclick={copyLink}>{topic}</button>
			<span class="peer-count">{peers.length} peers</span>
		</div>

		<div class="ctrl-row">
			<button
				class="ctrl-btn"
				class:active={speaking}
				onclick={speaking ? stopSpeaking : startSpeaking}
				title={speaking ? 'Stop speaking' : 'Start speaking'}
			>
				{speaking ? '🎙 SPEAKING' : '🎙 SPEAK'}
			</button>
			<button
				class="ctrl-btn"
				class:muted={!listening}
				onclick={() => (listening = !listening)}
				title={listening ? 'Mute incoming' : 'Unmute incoming'}
			>
				{listening ? '🔊' : '🔇 MUTED'}
			</button>
			<button class="ctrl-btn leave-btn" onclick={leave} title="Leave channel">LEAVE</button>
		</div>

		<div class="msg-log" bind:this={msgLog}>
			{#each messages as msg (msg.ts)}
				<div class="msg" class:me={msg.from === 'me'}>
					<span class="msg-from">{msg.from === 'me' ? 'you' : msg.from}</span>
					<span class="msg-text">{msg.text}</span>
				</div>
			{/each}
			{#if messages.length === 0}
				<span class="empty-log">no messages yet</span>
			{/if}
		</div>

		<div class="text-row">
			<input
				class="text-input"
				type="text"
				placeholder="type message…"
				bind:value={textInput}
				onkeydown={(e) => e.key === 'Enter' && sendText()}
			/>
			<button class="send-btn" onclick={sendText} title="Send">↵</button>
		</div>

		{#if errorMsg}
			<div class="error-zone">{errorMsg}</div>
		{/if}
	</div>
{/if}

<style>
	.widget {
		position: fixed;
		top: 34px;
		right: 10px;
		z-index: 1000;
		font-family: var(--font-mono);
		font-size: 11px;
		background: var(--bg-surface);
		border: 1px solid var(--zone-green);
		border-top: none;
		border-radius: 0 0 6px 6px;
		box-shadow:
			0 8px 24px rgba(0, 0, 0, 0.5),
			0 0 8px rgba(72, 187, 120, 0.15);
		color: #cdd6f4;
		display: flex;
		flex-direction: column;
		width: 240px;
		padding: 8px 10px;
		gap: 7px;
	}

	.live-bar {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 10px;
	}

	.live-dot {
		display: inline-block;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--zone-green);
		animation: pulse 1.5s ease-in-out infinite;
		flex-shrink: 0;
	}

	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.3; }
	}

	.live-label {
		color: var(--zone-green);
		font-weight: 600;
		letter-spacing: 0.08em;
	}

	.topic-link {
		background: none;
		border: none;
		cursor: pointer;
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--zone-yellow);
		padding: 0;
		max-width: 80px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.topic-link:hover { text-decoration: underline; text-decoration-style: dotted; }

	.peer-count {
		margin-left: auto;
		color: #7c8cad;
		font-size: 10px;
	}

	.ctrl-row {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
	}

	.ctrl-btn {
		background: none;
		border: 1px solid var(--border-dim);
		border-radius: 3px;
		color: inherit;
		cursor: pointer;
		font-family: var(--font-mono);
		font-size: 10px;
		padding: 2px 5px;
		line-height: 1.4;
		transition: border-color 0.15s, color 0.15s;
	}

	.ctrl-btn:hover { border-color: #7c8cad; }
	.ctrl-btn.active { border-color: var(--zone-green); color: var(--zone-green); }
	.ctrl-btn.muted  { border-color: var(--zone-red); color: var(--zone-red); }

	.leave-btn {
		margin-left: auto;
		color: var(--zone-red);
		border-color: rgba(252, 88, 88, 0.5);
	}

	.leave-btn:hover { background: rgba(252, 88, 88, 0.1); }

	.msg-log {
		background: #0d1117;
		border: 1px solid var(--border-dim);
		border-radius: 3px;
		max-height: 140px;
		overflow-y: auto;
		padding: 6px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.empty-log {
		color: #4a5568;
		font-size: 10px;
		text-align: center;
		padding: 6px 0;
	}

	.msg {
		display: flex;
		gap: 5px;
		font-size: 10px;
	}

	.msg-from { color: #7c8cad; flex-shrink: 0; }
	.msg.me .msg-from { color: var(--zone-yellow); }
	.msg-text { color: #cdd6f4; word-break: break-word; }

	.text-row {
		display: flex;
		gap: 4px;
	}

	.text-input {
		flex: 1;
		background: #0d1117;
		border: 1px solid var(--border-dim);
		border-radius: 3px;
		color: #cdd6f4;
		font-family: var(--font-mono);
		font-size: 11px;
		padding: 4px 6px;
		outline: none;
	}

	.text-input:focus { border-color: #7c8cad; }

	.send-btn {
		background: none;
		border: 1px solid var(--border-dim);
		border-radius: 3px;
		color: #7c8cad;
		cursor: pointer;
		font-size: 12px;
		padding: 2px 6px;
	}

	.send-btn:hover { border-color: #7c8cad; color: #cdd6f4; }

	.error-zone {
		border: 1px solid var(--zone-red);
		border-radius: 3px;
		color: var(--zone-red);
		font-size: 10px;
		padding: 5px 7px;
		word-break: break-word;
	}
</style>
