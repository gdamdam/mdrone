// mdrone voice worklet — processor registration. Must come last in
// the concatenation order so every per-voice prototype extension is
// already attached to DroneVoiceProcessor before it is handed to
// AudioWorkletGlobalScope.

registerProcessor("drone-voice", DroneVoiceProcessor);
