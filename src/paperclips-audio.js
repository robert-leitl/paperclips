import * as Tone from 'tone'

export class PaperclipsAudio {

    MUTE_COLLISION_SOUND_TIMEOUT = 50;
    muteCollisionSoundTimeoutId = null;

    constructor() {
        const compressor = new Tone.Compressor().toDestination();
        const destination = compressor;

        this.frontPlaneCollisionSound = new Tone.MetalSynth({
            frequency: 45,
            envelope: {
                attack: 0.001,
                decay: 0.4,
                release: 0.2
            },
            harmonicity: 8.5,
            modulationIndex: 40,
            resonance: 300,
            octaves: 1.5
        });
        this.frontPlaneCollisionSound.chain(destination);

        const impulseLowPass = new Tone.Filter(200, 'lowpass');
        const impulseReverb = new Tone.Reverb(4);
        this.impulseSound = new Tone.MembraneSynth({
            volume: -20,
            envelope: {
                attack: 0.005,
                decay: 0.8,
                sustain: 0.1
            },
            octaves: 5
        });
        this.impulseSound.chain(impulseLowPass, destination);

        Tone.Transport.bpm.value = 120;
        Tone.Transport.stop();
        setTimeout(() => Tone.Transport.start(), 100);
    }

    playFrontPlaneCollisionSound(strength) {
        if (this.muteCollisionSoundTimeoutId) return;

        const volume = Math.min(strength, 25) - 45;
        this.frontPlaneCollisionSound.volume.value = volume;
        this.frontPlaneCollisionSound.triggerAttackRelease('C4', '8n', Tone.Transport.now());
    }

    playImpulseSound() {
        this.muteCollisionSoundTimeoutId = setTimeout(() => this.muteCollisionSoundTimeoutId = null, this.MUTE_COLLISION_SOUND_TIMEOUT);
        this.impulseSound.triggerAttackRelease('C3', '8n', Tone.Transport.now());
    }
}