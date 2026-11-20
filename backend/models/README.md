# Model checkpoints

Put the five Mel-MLP checkpoints produced by `pipeline/02_mlp.ipynb` here (download from the Kaggle
notebook output, folder `mlp/`):

    mlp_mel_seed0.pt ... mlp_mel_seed4.pt

Then set `tau` in `config.json` to the value the notebook prints for `mel` (`tau per feature: {...}`).
The five `mlp_mel_seed*.pt` files (about 8 MB each) are committed with `tau = 0.6` (from the notebook log).
