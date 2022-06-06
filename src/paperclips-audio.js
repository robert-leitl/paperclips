import * as Tone from 'tone'

export class PaperclipsAudio {

    MUTE_COLLISION_SOUND_TIMEOUT = 50;
    muteCollisionSoundTimeoutId = null;

    constructor() {
        const compressor = new Tone.Compressor().toDestination();
        const destination = compressor;

        this.frontPlaneCollisionSound = new Tone.MetalSynth();
        this.frontPlaneCollisionSound.chain(destination);

        const impulseLowPass = new Tone.Filter(100, 'lowpass');
        this.impulseSound = new Tone.MembraneSynth({
            volume: 0,
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
    }

    playFrontPlaneCollisionSound(strength) {
        if (this.muteCollisionSoundTimeoutId) return;

        const volume = Math.min(strength, 25) - 25;
        this.frontPlaneCollisionSound.volume.value = volume;
        this.frontPlaneCollisionSound.triggerAttackRelease('C3', '16n', Tone.Transport.now());
    }

    playImpulseSound() {
        this.muteCollisionSoundTimeoutId = setTimeout(() => this.muteCollisionSoundTimeoutId = null, this.MUTE_COLLISION_SOUND_TIMEOUT);
        this.impulseSound.triggerAttackRelease('C2', '8n', Tone.Transport.now());
    }
}