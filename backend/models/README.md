# Model checkpoints

Put the five Mel-MLP checkpoints produced by `pipeline/02_mlp.ipynb` here (download from the Kaggle
notebook output, folder `mlp/`):

    mlp_mel_seed0.pt ... mlp_mel_seed4.pt

Then set `tau` in `config.json` to the value the notebook prints for `mel` (`tau per feature: {...}`).
`*.pt` files are git-ignored by default; remove that rule in `.gitignore` if you want to commit them (about 1 MB each).
