export interface StageElements {
  status: HTMLElement;
  avatar: HTMLElement;
  analysisOverlay: HTMLElement;
  analysisStepText: HTMLElement;
  analysisThoughts: HTMLElement;
  analysisHint: HTMLElement;
  avatarSelect: HTMLSelectElement;
  songInput: HTMLInputElement;
  heroTitle: HTMLElement;
  heroSubtitle: HTMLElement;
  heroLyrics: HTMLElement;
  stageHeroDesc: HTMLElement;
  transcript: HTMLTextAreaElement;
  transcribeBtn: HTMLButtonElement;
  analyzeBtn: HTMLButtonElement;
  playBtn: HTMLButtonElement;
  lipsyncBtn: HTMLButtonElement;
  stopBtn: HTMLButtonElement;
  soloOnly: HTMLInputElement;
  llmModelSelect: HTMLSelectElement;
  vlmModelSelect: HTMLSelectElement;
  directorModelSelect: HTMLSelectElement;
  sttModelSelect: HTMLSelectElement;
  ttsModelSelect: HTMLSelectElement;
  embedModelSelect: HTMLSelectElement;
  voiceSelect: HTMLSelectElement;
  llmRuntimeLoaded: HTMLElement;
  llmRuntimeModel: HTMLElement;
  llmRuntimeType: HTMLElement;
  llmRuntimeQueue: HTMLElement;
  llmRuntimeActive: HTMLElement;
  llmRuntimeConfig: HTMLElement;
  llmRuntimeStatus: HTMLElement;
  llmRuntimeModelSelect: HTMLSelectElement;
  llmRuntimeRefresh: HTMLButtonElement;
  llmRuntimeUnload: HTMLButtonElement;
  llmRuntimeLoad: HTMLButtonElement;
  llmRuntimeForce: HTMLInputElement;
  directorStyle: HTMLSelectElement;
  dataPoolTitle: HTMLInputElement;
  dataPoolIncludeAudio: HTMLInputElement;
  dataPoolSave: HTMLButtonElement;
  dataPoolRefresh: HTMLButtonElement;
  dataPoolSelect: HTMLSelectElement;
  dataPoolLoad: HTMLButtonElement;
  dataPoolStatus: HTMLElement;
  sttChip: HTMLElement;
  chatChip: HTMLElement;
  vlmChip: HTMLElement;
  llmChip: HTMLElement;
  embedChip: HTMLElement;
  audioChip: HTMLElement;
  approveBtn: HTMLButtonElement;
  planStatus: HTMLElement;
  planList: HTMLElement;
  planDetails: HTMLElement;
  directorNotes: HTMLElement;
  hudScene: HTMLElement;
  hudCamera: HTMLElement;
  hudLights: HTMLElement;
  hudMode: HTMLElement;
  cameraView: HTMLSelectElement;
  cameraDistance: HTMLInputElement;
  cameraX: HTMLInputElement;
  cameraY: HTMLInputElement;
  cameraRotateX: HTMLInputElement;
  cameraRotateY: HTMLInputElement;
  autoRotate: HTMLInputElement;
  autoRotateSpeed: HTMLInputElement;
  cameraDistanceVal: HTMLElement;
  cameraXVal: HTMLElement;
  cameraYVal: HTMLElement;
  cameraRotateXVal: HTMLElement;
  cameraRotateYVal: HTMLElement;
  autoRotateSpeedVal: HTMLElement;
  lightPreset: HTMLSelectElement;
  ambientColor: HTMLInputElement;
  directColor: HTMLInputElement;
  spotColor: HTMLInputElement;
  ambientIntensity: HTMLInputElement;
  directIntensity: HTMLInputElement;
  spotIntensity: HTMLInputElement;
  ambientIntensityVal: HTMLElement;
  directIntensityVal: HTMLElement;
  spotIntensityVal: HTMLElement;
  lightPulse: HTMLInputElement;
  analysisProgressBar: HTMLElement;
  stageBadgePerformance: HTMLElement;
  stageBadgeStage: HTMLElement;
  stageBadgeCamera: HTMLElement;
  stageBadgePostFx: HTMLElement;
  directorEnablePerformance: HTMLInputElement;
  directorEnableStage: HTMLInputElement;
  directorEnableCamera: HTMLInputElement;
  directorEnablePostFx: HTMLInputElement;
  // Duo Mode
  duoModeToggle: HTMLInputElement;
  duoModeOptions: HTMLElement;
  avatarASelect: HTMLSelectElement;
  avatarBSelect: HTMLSelectElement;
  duoMutualGazeBtn: HTMLButtonElement;
  duoFaceCameraBtn: HTMLButtonElement;
  duoTestABtn: HTMLButtonElement;
  duoTestBBtn: HTMLButtonElement;
}

let cachedElements: StageElements | null = null;

export const getElements = (): StageElements => {
  if (cachedElements) return cachedElements;

  cachedElements = {
    status: document.getElementById("status") as HTMLElement,
    avatar: document.getElementById("avatar") as HTMLElement,
    analysisOverlay: document.getElementById("analysisOverlay") as HTMLElement,
    analysisStepText: document.getElementById("analysisStepText") as HTMLElement,
    analysisThoughts: document.getElementById("analysisThoughts") as HTMLElement,
    analysisHint: document.getElementById("analysisHint") as HTMLElement,
    avatarSelect: document.getElementById("avatarSelect") as HTMLSelectElement,
    songInput: document.getElementById("songInput") as HTMLInputElement,
    heroTitle: document.getElementById("heroTitle") as HTMLElement,
    heroSubtitle: document.getElementById("heroSubtitle") as HTMLElement,
    heroLyrics: document.getElementById("heroLyrics") as HTMLElement,
    stageHeroDesc: document.getElementById("stageHeroDesc") as HTMLElement,
    transcript: document.getElementById("transcript") as HTMLTextAreaElement,
    transcribeBtn: document.getElementById("transcribeBtn") as HTMLButtonElement,
    analyzeBtn: document.getElementById("analyzeBtn") as HTMLButtonElement,
    playBtn: document.getElementById("playBtn") as HTMLButtonElement,
    lipsyncBtn: document.getElementById("lipsyncBtn") as HTMLButtonElement,
    stopBtn: document.getElementById("stopBtn") as HTMLButtonElement,
    soloOnly: document.getElementById("soloOnly") as HTMLInputElement,
    llmModelSelect: document.getElementById("llmModelSelect") as HTMLSelectElement,
    vlmModelSelect: document.getElementById("vlmModelSelect") as HTMLSelectElement,
    directorModelSelect: document.getElementById("directorModelSelect") as HTMLSelectElement,
    sttModelSelect: document.getElementById("sttModelSelect") as HTMLSelectElement,
    ttsModelSelect: document.getElementById("ttsModelSelect") as HTMLSelectElement,
    embedModelSelect: document.getElementById("embedModelSelect") as HTMLSelectElement,
    voiceSelect: document.getElementById("voiceSelect") as HTMLSelectElement,
    llmRuntimeLoaded: document.getElementById("llmRuntimeLoaded") as HTMLElement,
    llmRuntimeModel: document.getElementById("llmRuntimeModel") as HTMLElement,
    llmRuntimeType: document.getElementById("llmRuntimeType") as HTMLElement,
    llmRuntimeQueue: document.getElementById("llmRuntimeQueue") as HTMLElement,
    llmRuntimeActive: document.getElementById("llmRuntimeActive") as HTMLElement,
    llmRuntimeConfig: document.getElementById("llmRuntimeConfig") as HTMLElement,
    llmRuntimeStatus: document.getElementById("llmRuntimeStatus") as HTMLElement,
    llmRuntimeModelSelect: document.getElementById("llmRuntimeModelSelect") as HTMLSelectElement,
    llmRuntimeRefresh: document.getElementById("llmRuntimeRefresh") as HTMLButtonElement,
    llmRuntimeUnload: document.getElementById("llmRuntimeUnload") as HTMLButtonElement,
    llmRuntimeLoad: document.getElementById("llmRuntimeLoad") as HTMLButtonElement,
    llmRuntimeForce: document.getElementById("llmRuntimeForce") as HTMLInputElement,
    directorStyle: document.getElementById("directorStyle") as HTMLSelectElement,
    dataPoolTitle: document.getElementById("dataPoolTitle") as HTMLInputElement,
    dataPoolIncludeAudio: document.getElementById("dataPoolIncludeAudio") as HTMLInputElement,
    dataPoolSave: document.getElementById("dataPoolSave") as HTMLButtonElement,
    dataPoolRefresh: document.getElementById("dataPoolRefresh") as HTMLButtonElement,
    dataPoolSelect: document.getElementById("dataPoolSelect") as HTMLSelectElement,
    dataPoolLoad: document.getElementById("dataPoolLoad") as HTMLButtonElement,
    dataPoolStatus: document.getElementById("dataPoolStatus") as HTMLElement,
    sttChip: document.getElementById("sttChip") as HTMLElement,
    chatChip: document.getElementById("chatChip") as HTMLElement,
    vlmChip: document.getElementById("vlmChip") as HTMLElement,
    llmChip: document.getElementById("llmChip") as HTMLElement,
    embedChip: document.getElementById("embedChip") as HTMLElement,
    audioChip: document.getElementById("audioChip") as HTMLElement,
    approveBtn: document.getElementById("approveBtn") as HTMLButtonElement,
    planStatus: document.getElementById("planStatus") as HTMLElement,
    planList: document.getElementById("planList") as HTMLElement,
    planDetails: document.getElementById("planDetails") as HTMLElement,
    directorNotes: document.getElementById("directorNotes") as HTMLElement,
    hudScene: document.getElementById("hudScene") as HTMLElement,
    hudCamera: document.getElementById("hudCamera") as HTMLElement,
    hudLights: document.getElementById("hudLights") as HTMLElement,
    hudMode: document.getElementById("hudMode") as HTMLElement,
    cameraView: document.getElementById("cameraView") as HTMLSelectElement,
    cameraDistance: document.getElementById("cameraDistance") as HTMLInputElement,
    cameraX: document.getElementById("cameraX") as HTMLInputElement,
    cameraY: document.getElementById("cameraY") as HTMLInputElement,
    cameraRotateX: document.getElementById("cameraRotateX") as HTMLInputElement,
    cameraRotateY: document.getElementById("cameraRotateY") as HTMLInputElement,
    autoRotate: document.getElementById("autoRotate") as HTMLInputElement,
    autoRotateSpeed: document.getElementById("autoRotateSpeed") as HTMLInputElement,
    cameraDistanceVal: document.getElementById("cameraDistanceVal") as HTMLElement,
    cameraXVal: document.getElementById("cameraXVal") as HTMLElement,
    cameraYVal: document.getElementById("cameraYVal") as HTMLElement,
    cameraRotateXVal: document.getElementById("cameraRotateXVal") as HTMLElement,
    cameraRotateYVal: document.getElementById("cameraRotateYVal") as HTMLElement,
    autoRotateSpeedVal: document.getElementById("autoRotateSpeedVal") as HTMLElement,
    lightPreset: document.getElementById("lightPreset") as HTMLSelectElement,
    ambientColor: document.getElementById("ambientColor") as HTMLInputElement,
    directColor: document.getElementById("directColor") as HTMLInputElement,
    spotColor: document.getElementById("spotColor") as HTMLInputElement,
    ambientIntensity: document.getElementById("ambientIntensity") as HTMLInputElement,
    directIntensity: document.getElementById("directIntensity") as HTMLInputElement,
    spotIntensity: document.getElementById("spotIntensity") as HTMLInputElement,
    ambientIntensityVal: document.getElementById("ambientIntensityVal") as HTMLElement,
    directIntensityVal: document.getElementById("directIntensityVal") as HTMLElement,
    spotIntensityVal: document.getElementById("spotIntensityVal") as HTMLElement,
    lightPulse: document.getElementById("lightPulse") as HTMLInputElement,
    analysisProgressBar: document.getElementById("analysisProgressBar") as HTMLElement,
    stageBadgePerformance: document.getElementById("stageBadgePerformance") as HTMLElement,
    stageBadgeStage: document.getElementById("stageBadgeStage") as HTMLElement,
    stageBadgeCamera: document.getElementById("stageBadgeCamera") as HTMLElement,
    stageBadgePostFx: document.getElementById("stageBadgePostFx") as HTMLElement,
    directorEnablePerformance: document.getElementById("directorEnablePerformance") as HTMLInputElement,
    directorEnableStage: document.getElementById("directorEnableStage") as HTMLInputElement,
    directorEnableCamera: document.getElementById("directorEnableCamera") as HTMLInputElement,
    directorEnablePostFx: document.getElementById("directorEnablePostFx") as HTMLInputElement,
    // Duo Mode
    duoModeToggle: document.getElementById("duoModeToggle") as HTMLInputElement,
    duoModeOptions: document.getElementById("duoModeOptions") as HTMLElement,
    avatarASelect: document.getElementById("avatarASelect") as HTMLSelectElement,
    avatarBSelect: document.getElementById("avatarBSelect") as HTMLSelectElement,
    duoMutualGazeBtn: document.getElementById("duoMutualGazeBtn") as HTMLButtonElement,
    duoFaceCameraBtn: document.getElementById("duoFaceCameraBtn") as HTMLButtonElement,
    duoTestABtn: document.getElementById("duoTestABtn") as HTMLButtonElement,
    duoTestBBtn: document.getElementById("duoTestBBtn") as HTMLButtonElement
  };

  return cachedElements;
};

export const clearElementsCache = () => {
  cachedElements = null;
};
