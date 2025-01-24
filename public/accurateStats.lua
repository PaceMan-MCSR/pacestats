-- Version 1.0.1

-- THIS IS AN OBS SCRIPT, NOT A JULTI SCRIPT
-- No config is required in this file, but if your resets.txt file is not in ~/.Julti/resets.txt,
-- such as if you are using a different macro (or the atum.properties file),
-- you will need to change the path in the OBS script properties GUI

obs = obslua

file_path = ""
last_resets = nil
browsers = {}
home = os.getenv("HOME") or os.getenv("UserProfile")

function redetect_browsers()
	browsers = {}
	local sources = obs.obs_enum_sources()
	for _, item in ipairs(sources) do
	    if obs.obs_source_get_id(item) == "browser_source" then
		    local name = obs.obs_source_get_name(item)
			local data = obs.obs_source_get_settings(item)
			local a = obs.obs_data_get_json(data)
			if string.find(a, "/stats/") then
				table.insert(browsers, name)
			end
			obs.obs_data_release(data)
		end
	end
	obs.source_list_release(sources)
end

function read_first_line(filename)
    local rfile = io.open(filename, "r")
    if rfile == nil then
        return ""
    end
    io.input(rfile)
    local out = io.read()
    io.close(rfile)
    return out
end

function get_resets()
    if file_path == "" then
	    return nil
	end
    if string.find(file_path, "atum.properties") then
        local f = io.open(file_path, "r")
        for line in f:lines() do
            if(string.find(line, "rsgAttempts")) then
                local res = string.sub(line, 13)
                f:close()
                return res
            end
        end
        f:close()
        return nil
    end
    local success, result = pcall(read_first_line, file_path)
    if success then
        return result
    end
    return nil
end

function loop()
    local out = get_resets()
    if out ~= nil and last_resets ~= out then
		if last_resets ~= nil then
			cd = obs.calldata_create()
			obs.calldata_set_string(cd, "eventName", "pingNPH")
			obs.calldata_set_string(cd, "jsonString", "{\"resets\":" .. out .. ",\"version\":\"1.0.1\"}")
			for _, item in pairs(browsers) do
				local src = obs.obs_get_source_by_name(item)
				obs.proc_handler_call(obs.obs_source_get_proc_handler(src), "javascript_event", cd)
				obs.obs_source_release(src)
			end
			obs.calldata_destroy(cd)
		end
        last_resets = out
    else
        return
    end
end

function script_properties()
    local props = obs.obs_properties_create()

    obs.obs_properties_add_path(props, "resets_path", "Reset counter file:", 0, "(*.txt *.properties)", home:gsub("\\", "/") .. "/.Julti/resets.txt")
    return props
end

function script_update(settings)
    if obs.obs_data_get_string(settings, "resets_path") == "" then
        obs.obs_data_set_string(settings, "resets_path", home:gsub("\\", "/") .. "/.Julti/resets.txt")
	end
	file_path = obs.obs_data_get_string(settings, "resets_path")
	obs.timer_remove(loop)
    obs.timer_add(loop, 50)
	obs.timer_remove(redetect_browsers)
	obs.timer_add(redetect_browsers, 30 * 1000)
	redetect_browsers()
end