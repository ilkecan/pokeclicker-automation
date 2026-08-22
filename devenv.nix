{
  config,
  pkgs,
  ...
}:

{
  env = {
    JUST_JUSTFILE = "${config.env.JUST_WORKING_DIRECTORY}/just/justfile";
    JUST_ONE = "true";
    JUST_WORKING_DIRECTORY = config.git.root;
  };

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

  packages = with pkgs; [
    zellij
  ];
}
