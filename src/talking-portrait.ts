for (const clip of document.querySelectorAll<HTMLVideoElement>(".portrait-clips video")) {
  const showError = () => {
    const status = clip.parentElement?.querySelector<HTMLElement>("[role=status]");
    if (status) status.textContent = "Clip unavailable. Open this case from a local Avatar Labs preview with B3 media enabled.";
  };
  clip.addEventListener("error", showError);
  if (clip.error) showError();
}
