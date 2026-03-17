export const tune = $state({
	expanded: false,
	status: 'idle' as 'idle' | 'connecting' | 'live' | 'error',
	inputTopic: '',
	tuneRequest: 0,   // increment to trigger tune()
	liveTopic: '',
	peerCount: 0,
	liveCopyLink: null as (() => void) | null,
});
