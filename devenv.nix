{
  pkgs,
  ...
}:

{
  git-hooks.hooks = {
    comrak.enable = true;
    deadnix.enable = true;
    flake-checker.enable = true;
    nil.enable = true;
    nixf-diagnose.enable = true;
    nixfmt.enable = true;
    ripsecrets.enable = true;
  };

  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_26;
  };
}
