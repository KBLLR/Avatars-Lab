export type { RegistryModel, ModelRuntimeStatus } from "../stage/types";

export interface RuntimePanelElements {
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
}

export interface ModelSelectorElements {
  llmModelSelect: HTMLSelectElement;
  directorModelSelect: HTMLSelectElement;
  sttModelSelect: HTMLSelectElement;
  ttsModelSelect: HTMLSelectElement;
  llmRuntimeModelSelect: HTMLSelectElement;
  sttChip: HTMLElement;
  chatChip: HTMLElement;
  llmChip: HTMLElement;
}

export interface MlxConfig {
  llmBaseUrl?: string;
  audioBaseUrl?: string;
  llmModel?: string;
  sttModel?: string;
  ttsModel?: string;
  directorModel?: string;
  ttsVoice?: string;
}
