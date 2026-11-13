// Refine faces: a finished shot's face tracked, cropped to fill a 768 px canvas, redrawn by MiniMax H3 against the
// person's face picture (and their character LoRA), and stitched back into the original frames, so a small face in
// a wide shot gets the detail and likeness a close-up has. Carasibana's ComfyUI-H3-FaceRefine (MIT) does the
// tracking, the per-frame strength and the stitch; IV Studio builds its graph on IV Studio's own H3 files.
// Tested on a wide Tess shot (2026-11-13): likeness to her face picture went from 0.00 to 0.35 on a small face, 0.42
// to 0.47 on a close one, in about 5 minutes for 124 frames with the model load.

export const FACE_NODES = ['H3FaceTrackCrop', 'H3FaceStitch', 'H3PerFrameDenoise', 'H3InjectVideoLatent']
export const FACE_DETECTOR = 'face_yolov8m.pt'
export const FACE_TURBO = 'minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors'
// how strongly the face is redrawn: H3's denoise, scaled down per frame for faces already big in the frame
export const FACE_STRENGTHS = { light: 0.3, normal: 0.4, strong: 0.55 }

const H3 = {
  unet: 'Minimax H3\\minimax_h3_ref2va_pruned_int8_convrot.safetensors',
  clip: 'qwen3vl_32b_minimax_h3_int4_convrot.safetensors',
  vae: 'minimax_h3_video_vae_int8_convrot.safetensors',
  audioVae: 'minimax_h3_audio_vae_fp32.safetensors',
  // lightx2v's ref2v turbo at 8 steps, made for 768 px: what FaceRefine's own example runs. Kijai's DMAD 4-step LoRA
  // (IV Studio's shot turbo) at the same steps lifted Tess's small face only from 0.00 to 0.04 likeness; this one to 0.26
  turbo: 'minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors'
}

// The words H3 is given for the face crop. who: the person's name, or ''.
export function facePromptFor({ who = '', picture = false } = {}) {
  const person = picture ? `the ${who ? `${who}, the ` : ''}person in <Picture 1>` : who || 'the person'
  return `Close-up of ${person}. Their face and hair exactly as in ${picture ? '<Picture 1>' : 'the shot'}: the same eyes, nose, mouth, skin and expression, in the shot's own light. Natural, realistic skin, sharp eyes. The camera, the pose and the motion stay as they are.`
}

// The ComfyUI graph. video: a path VHS_LoadVideoPath reads (or { cls, video } from Studio.videoSource); face: the
// uploaded face picture's name in ComfyUI's input, or null (then the largest face is refined, with no reference);
// lora: { name, strength } for the person's character LoRA, or null; strength: H3's denoise for small faces.
export function faceRefineGraph({ video, face = null, lora = null, strength = FACE_STRENGTHS.normal, who = '', fps = 24, prefix = 'H3/enhanced/faces' }) {
  const src = typeof video === 'string' ? { cls: 'VHS_LoadVideoPath', video } : video
  const model = lora ? 'lora' : 'turbo'
  return {
    load: { class_type: src.cls, inputs: { video: src.video, force_rate: 0, custom_width: 0, custom_height: 0, frame_load_cap: 0, skip_first_frames: 0, select_every_nth: 1, format: 'AnimateDiff' } },
    ...(face ? { face: { class_type: 'LoadImage', inputs: { image: face } } } : {}),
    track: {
      class_type: 'H3FaceTrackCrop',
      inputs: {
        images: ['load', 0], detector: FACE_DETECTOR, confidence: 0.35, crop_factor: 3, canvas_width: 768, canvas_height: 768, canvas_mode: 'auto_capped_768',
        smooth_window: 21, size_smooth_window: 51, smooth_method: 'gaussian', size_mode: 'per_frame', select: 'largest_face', fallback_detector: 'none',
        cut_detection: 'auto (pyscenedetect)', ...(face ? { identity_reference: ['face', 0], identity_track: true, identity_threshold: 0.28 } : {})
      }
    },
    unet: { class_type: 'UNETLoader', inputs: { unet_name: H3.unet, weight_dtype: 'default' } },
    clip: { class_type: 'CLIPLoader', inputs: { clip_name: H3.clip, type: 'minimax', device: 'default' } },
    vae: { class_type: 'VAELoader', inputs: { vae_name: H3.vae } },
    avae: { class_type: 'VAELoader', inputs: { vae_name: H3.audioVae } },
    turbo: { class_type: 'LoraLoaderModelOnly', inputs: { model: ['unet', 0], lora_name: H3.turbo, strength_model: 1 } },
    ...(lora ? { lora: { class_type: 'LoraLoaderModelOnly', inputs: { model: ['turbo', 0], lora_name: lora.name, strength_model: lora.strength ?? 0.8 } } } : {}),
    cond: {
      class_type: 'MiniMaxH3ReferenceToVideo',
      inputs: {
        clip: ['clip', 0], prompt: facePromptFor({ who, picture: !!face }), width: ['track', 4], height: ['track', 5], length: ['track', 6], ref_image_size: 'match', vae: ['vae', 0], audio_vae: ['avae', 0],
        ...(face ? { 'ref_images.ref_image_0': ['face', 0] } : {}), 'ref_audios.ref_audio_0': ['load', 2]
      }
    },
    inject: { class_type: 'H3InjectVideoLatent', inputs: { av_latent: ['cond', 1], images: ['track', 0], vae: ['vae', 0] } },
    per: { class_type: 'H3PerFrameDenoise', inputs: { model: [model, 0], av_latent: ['inject', 0], transform: ['track', 1], denoise_multiplier_small_face: 1, denoise_multiplier_large_face: 0.35, scale_mode: 'absolute_px', face_px_small: 30, face_px_large: 120, gamma: 1, smooth_frames: 9 } },
    sampler: { class_type: 'KSamplerSelect', inputs: { sampler_name: 'er_sde' } },
    sigmas: { class_type: 'BasicScheduler', inputs: { model: ['per', 2], scheduler: 'simple', steps: 8, denoise: strength } },
    noise: { class_type: 'RandomNoise', inputs: { noise_seed: 42 } },
    guider: { class_type: 'BasicGuider', inputs: { model: ['per', 2], conditioning: ['cond', 0] } },
    sample: { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['noise', 0], guider: ['guider', 0], sampler: ['sampler', 0], sigmas: ['sigmas', 0], latent_image: ['per', 0] } },
    decode: { class_type: 'VAEDecode', inputs: { samples: ['sample', 0], vae: ['vae', 0] } },
    stitch: { class_type: 'H3FaceStitch', inputs: { base_images: ['load', 0], refined_crops: ['decode', 0], transform: ['track', 1], paste_region: 'face_only', mask_dilation: 24, feather: 24, colour_match: 1, blend: 1, undetected_frames: 'fade_out' } },
    save: { class_type: 'VHS_VideoCombine', inputs: { images: ['stitch', 0], audio: ['load', 2], frame_rate: fps, loop_count: 0, filename_prefix: prefix, format: 'video/h264-mp4', pix_fmt: 'yuv420p', crf: 16, save_metadata: true, trim_to_audio: false, pingpong: false, save_output: true } }
  }
}
