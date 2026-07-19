"""pwmtest v5 - register-hack test; MCU sketch does all the work, python idles."""
import time

from arduino.app_utils import App


def loop():
    time.sleep(5)


App.run(user_loop=loop)
