function buildGlassPanel() {
  const w = app.screen.width;
  const h = app.screen.height;

  if (glassPanel) { glassPanel.destroy(true); glassPanel = null; }

  glassPanel = new PIXI.Container();

  // ✅ léger voile "glass" sans bordure (aucun contour visible)
  const veil = new PIXI.Graphics();
  veil.beginFill(0x0a1026, 0.12);
  veil.drawRect(0, 0, w, h);
  veil.endFill();

  // ✅ vignette douce (assombrit légèrement les bords)
  const vignette = new PIXI.Graphics();
  vignette.beginFill(0x000000, 0.18);
  vignette.drawRect(0, 0, w, h);
  vignette.endFill();
  // on met un filtre blur léger pour faire "pro" (si dispo)
  if (PIXI.filters?.BlurFilter) {
    const blur = new PIXI.filters.BlurFilter();
    blur.blur = 6;
    vignette.filters = [blur];
  }
  vignette.alpha = 0.22;

  glassPanel.addChild(veil, vignette);
  app.stage.addChild(glassPanel);
}