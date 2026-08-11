from manim import *

config.pixel_width = 1080
config.pixel_height = 1920
config.frame_width = 9.0
config.frame_height = 16.0


class VerticalScene(Scene):
    def construct(self):
        self.play(Create(Square()), run_time=0.5)
