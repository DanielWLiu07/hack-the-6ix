# FarmHand NL-command end-to-end demo transcript

_the NL client - 10 commands driven through the LIVE hub (:3001)_

Chain per command: **web UI** `nl_command` -> hub -> **farmhand service** (trained model + strict schema validation) -> hub -> **UI echo** + **robot forward**.

**Summary:** 10 commands, 9 valid actions forwarded to robot, 1 clarification(s), 0 rejected (never reached robot).


## 1. `pick all ripe apples`

- **farmhand -> action**: `{'task': 'pick', 'fruit': 'apple', 'filter': 'ripe', 'zone': 'any'}`
- **hub forwarded to robot**: full `nl_action` yes, mapped control `[('pick', {'target': 'apple'})]`

## 2. `grab every ripe banana`

- **farmhand -> action**: `{'task': 'pick', 'fruit': 'banana', 'filter': 'ripe', 'zone': 'any'}`
- **hub forwarded to robot**: full `nl_action` yes, mapped control `[('pick', {'target': 'banana'})]`

## 3. `sort the unripe apples into the left bin`

- **farmhand -> action**: `{'task': 'sort', 'fruit': 'apple', 'filter': 'unripe', 'zone': 'any'}`
- **hub forwarded to robot**: full `nl_action` yes, mapped control `[('pick', {'target': 'apple'})]`

## 4. `PICK THE NEAREST FRUIT`

- **farmhand -> action**: `{'task': 'pick', 'fruit': 'any', 'filter': 'unripe', 'zone': 'any'}`
- **hub forwarded to robot**: full `nl_action` yes, mapped control `[('pick', {'target': 'nearest'})]`

## 5. `drive forward`

- **farmhand -> action**: `{'task': 'drive', 'fruit': 'any', 'filter': 'any', 'zone': 'forward'}`
- **hub forwarded to robot**: full `nl_action` yes

## 6. `yo can u snag me a banana thats not ripe`

- **farmhand -> action**: `{'task': 'pick', 'fruit': 'banana', 'filter': 'unripe', 'zone': 'any'}`
- **hub forwarded to robot**: full `nl_action` yes, mapped control `[('pick', {'target': 'banana'})]`

## 7. `stop!!!`

- **farmhand -> action**: `{'task': 'stop', 'fruit': 'any', 'filter': 'any', 'zone': 'any'}`
- **hub forwarded to robot**: full `nl_action` yes, mapped control `[('estop', {})]`

## 8. `pick the fruit`

- **farmhand -> clarification**: "Which fruit - apples, bananas, or both?"
- **robot**: nothing forwarded (awaiting user reply)

## 9. `take everything ripe to home base`

- **farmhand -> action**: `{'task': 'pick', 'fruit': 'any', 'filter': 'ripe', 'zone': 'home'}`
- **hub forwarded to robot**: full `nl_action` yes, mapped control `[('pick', {'target': 'nearest'})]`

## 10. `asdf qwerty zzz`

- **farmhand -> action**: `{'task': 'stop', 'fruit': 'any', 'filter': 'any', 'zone': 'any'}`
- **hub forwarded to robot**: full `nl_action` yes, mapped control `[('estop', {})]`
