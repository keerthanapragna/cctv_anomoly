import torch
import torch.nn as nn
from torchvision.models.video import r3d_18
from configs.config import  NUM_FRAMES
import math

class SinusoidalPositionalEncoding(nn.Module):
    def __init__(self, d_model, max_len=64):
        super().__init__()
        pe = torch.zeros(max_len, d_model)
        position = torch.arange(0, max_len, dtype=torch.float32).unsqueeze(1)
        div_term = torch.exp(torch.arange(0, d_model, 2).float() * (-math.log(10000.0) / d_model))

        pe[:, 0::2] = torch.sin(position * div_term)
        pe[:, 1::2] = torch.cos(position * div_term)

        pe = pe.unsqueeze(0)   # [1, max_len, d_model]
        self.register_buffer("pe", pe)

    def forward(self, x):
        # x: [B, T, D]
        T = x.size(1)
        return x + self.pe[:, :T, :]


class HybridVideoClassifier(nn.Module):
    def __init__(
        self,
        hidden_dim=512,
        num_classes=1,
        freeze_backbone=True,
        fine_tune_layer4=True,
        pretrained=False
    ):
        super().__init__()

        # Use weights=None to avoid redundant pretrained weight downloads when loading checkpoint
        try:
            backbone = r3d_18(weights=None)
        except TypeError:
            backbone = r3d_18(pretrained=pretrained)

        # Keep temporal feature maps (do NOT use backbone.fc anymore)
        self.stem = backbone.stem
        self.layer1 = backbone.layer1
        self.layer2 = backbone.layer2
        self.layer3 = backbone.layer3
        self.layer4 = backbone.layer4

        # Freeze backbone except chosen blocks
        if freeze_backbone:
            for module in [self.stem, self.layer1, self.layer2, self.layer3, self.layer4]:
                for param in module.parameters():
                    param.requires_grad = False

            if fine_tune_layer4:
                for param in self.layer4.parameters():
                    param.requires_grad = True

        # Spatial pooling only, keep temporal dimension
        self.spatial_pool = nn.AdaptiveAvgPool3d((None, 1, 1))

        # Positional encoding
        self.pos_encoder = SinusoidalPositionalEncoding(d_model=hidden_dim, max_len=64)

        # Transformer
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=hidden_dim,
            nhead=4,
            dim_feedforward=1024,
            dropout=0.1,
            batch_first=True
        )
        self.transformer = nn.TransformerEncoder(encoder_layer, num_layers=2)

        # Learned temporal attention pooling
        self.attention_pool = nn.Linear(hidden_dim, 1)

        # Dual heads
        self.classifier = nn.Linear(hidden_dim, num_classes)
        self.uncertainty_head = nn.Linear(hidden_dim, 1)

    def forward(self, x):
        # x: [B, F, C, H, W]
        x = x.permute(0, 2, 1, 3, 4).contiguous()   # [B, C, F, H, W]

        x = self.stem(x)
        x = self.layer1(x)
        x = self.layer2(x)
        x = self.layer3(x)
        x = self.layer4(x)                          # [B, 512, T', H', W']

        x = self.spatial_pool(x)                    # [B, 512, T', 1, 1]
        x = x.squeeze(-1).squeeze(-1)               # [B, 512, T']
        x = x.permute(0, 2, 1).contiguous()         # [B, T', 512]

        x = self.pos_encoder(x)
        x = self.transformer(x)                     # [B, T', 512]

        attn_scores = self.attention_pool(x)        # [B, T', 1]
        attn_weights = torch.softmax(attn_scores, dim=1)
        pooled = (x * attn_weights).sum(dim=1)      # [B, 512]

        logits = self.classifier(pooled).squeeze(1)         # [B]
        uncertainty = torch.sigmoid(self.uncertainty_head(pooled)).squeeze(1)  # [B]

        return logits, uncertainty